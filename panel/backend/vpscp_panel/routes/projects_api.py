from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession
from starlette.responses import StreamingResponse

import vpscp_panel.db as db_module
from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf, require_step_up
from vpscp_panel.deploy_ops import has_running_deploy
from vpscp_panel.models import (
    Deploy,
    Domain,
    PortAllocation,
    Project,
    ProjectHostname,
    ProjectRoute,
    ProjectService,
    Session,
)
from vpscp_panel.project_creation import (
    _nginx_spec,
    default_db_name,
    default_db_user,
    hostname_fqdn,
    initial_creation_state,
    run_creation,
)
from vpscp_panel.validation import (
    BranchName,
    DockerImageEnv,
    DomainName,
    EnvKey,
    RepoUrl,
    RoutePath,
    ServiceName,
    Slug,
    SqlIdent,
    Subdomain,
    TagPrefix,
    validate_docker_hub_repo,
    validate_sql_ident,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])
utility_router = APIRouter(prefix="/api", tags=["projects"])

_creation_tasks: dict[str, asyncio.Task] = {}


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


def _now(request: Request) -> datetime:
    return request.app.state.clock()


class HostnameInput(BaseModel):
    domain: DomainName
    subdomain: Subdomain = ""
    kind: Literal["primary", "alias", "redirect"]


class RouteInput(BaseModel):
    path_prefix: RoutePath
    port_env_var: EnvKey


class ServiceInput(BaseModel):
    service_name: ServiceName
    image_env_var: DockerImageEnv
    tag_prefix: TagPrefix


def _validate_unique_services(services: list[ServiceInput]) -> None:
    names = [row.service_name for row in services]
    if len(names) != len(set(names)):
        raise ValueError("duplicate service_name")
    env_vars = [row.image_env_var for row in services]
    if len(env_vars) != len(set(env_vars)):
        raise ValueError("duplicate image_env_var")


class CreateProjectBody(BaseModel):
    slug: Slug
    display_name: str
    repo: RepoUrl
    branch: BranchName
    compose_file: str
    deploy_mode: Literal["image", "build"]
    database_mode: Literal["none", "new", "adopted"]
    db_name: SqlIdent | None = None
    db_user: SqlIdent | None = None
    write_database_url: bool = False
    user_env: str | None = None
    hostnames: list[HostnameInput]
    routes: list[RouteInput]
    docker_hub_repo: str | None = None
    services: list[ServiceInput] = []

    @field_validator("display_name", "compose_file")
    @classmethod
    def non_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value

    @field_validator("user_env")
    @classmethod
    def env_no_newlines_in_values(cls, value: str | None) -> str | None:
        if value is None:
            return None
        for line in value.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            _, val = stripped.split("=", 1)
            if "\n" in val or "\r" in val:
                raise ValueError("env values must not contain newlines")
        return value

    @model_validator(mode="after")
    def check_hostnames_and_routes(self) -> CreateProjectBody:
        primaries = [h for h in self.hostnames if h.kind == "primary"]
        if len(primaries) != 1:
            raise ValueError("exactly one primary hostname required")
        if len(self.routes) < 1:
            raise ValueError("at least one route required")
        paths = [route.path_prefix for route in self.routes]
        if len(paths) != len(set(paths)):
            raise ValueError("route paths must be unique")
        _validate_unique_services(self.services)
        return self


class PutServicesBody(BaseModel):
    services: list[ServiceInput] = []

    @model_validator(mode="after")
    def check_unique(self) -> PutServicesBody:
        _validate_unique_services(self.services)
        return self


class DeleteProjectBody(BaseModel):
    confirm: str
    drop_database: bool = False
    remove_dns: bool = False


class PatchProjectBody(BaseModel):
    migration_command: str | None = None
    migration_service: str | None = None
    health_check_url: str | None = None


class TestAccessBody(BaseModel):
    slug: Slug


class PutEnvBody(BaseModel):
    content: str


class PatchEnvBody(BaseModel):
    set: dict[str, str] = {}
    unset: list[str] = []


class RoutingHostnameInput(BaseModel):
    domain: DomainName
    subdomain: Subdomain = ""
    kind: Literal["primary", "alias", "redirect"]


class RoutingRouteInput(BaseModel):
    path_prefix: RoutePath
    port_env_var: EnvKey
    max_body_mb: int = Field(25, ge=1, le=10240)
    read_timeout_s: int = Field(60, ge=1, le=3600)
    send_timeout_s: int = Field(60, ge=1, le=3600)
    streaming: bool = False
    websocket: bool = False
    pass_authorization: bool = False


class PutRoutingBody(BaseModel):
    hostnames: list[RoutingHostnameInput]
    routes: list[RoutingRouteInput]

    @model_validator(mode="after")
    def check_routing(self) -> PutRoutingBody:
        primaries = [h for h in self.hostnames if h.kind == "primary"]
        if len(primaries) != 1:
            raise ValueError("exactly one primary hostname required")
        if len(self.routes) < 1:
            raise ValueError("at least one route required")
        paths = [route.path_prefix for route in self.routes]
        if len(paths) != len(set(paths)):
            raise ValueError("duplicate route path")
        for route in self.routes:
            if route.streaming and route.websocket:
                raise ValueError("route cannot be both streaming and websocket")
        return self


def _project_payload(project: Project) -> dict[str, Any]:
    return {
        "slug": project.slug,
        "display_name": project.display_name,
        "repo_url": project.repo_url,
        "branch": project.branch,
        "compose_file": project.compose_file,
        "deploy_mode": project.deploy_mode,
        "docker_hub_repo": project.docker_hub_repo,
        "database_mode": project.database_mode,
        "db_name": project.db_name,
        "db_user": project.db_user,
        "write_database_url": project.write_database_url,
        "migration_command": project.migration_command,
        "migration_service": project.migration_service,
        "health_check_url": project.health_check_url,
        "creation_state": json.loads(project.creation_state),
        "created_at": project.created_at.isoformat(),
    }


def _project_detail_payload(db: DbSession, project: Project) -> dict[str, Any]:
    payload = _project_payload(project)
    hostnames = db.scalars(
        select(ProjectHostname).where(ProjectHostname.project_slug == project.slug)
    ).all()
    routes = db.scalars(select(ProjectRoute).where(ProjectRoute.project_slug == project.slug)).all()
    services = db.scalars(
        select(ProjectService).where(ProjectService.project_slug == project.slug)
    ).all()
    payload["hostnames"] = [
        {
            "domain": row.domain,
            "subdomain": row.subdomain,
            "kind": row.kind,
        }
        for row in hostnames
    ]
    payload["routes"] = [
        {
            "path_prefix": row.path_prefix,
            "port_env_var": row.port_env_var,
            "max_body_mb": row.max_body_mb,
            "read_timeout_s": row.read_timeout_s,
            "send_timeout_s": row.send_timeout_s,
            "streaming": row.streaming,
            "websocket": row.websocket,
            "pass_authorization": row.pass_authorization,
        }
        for row in routes
    ]
    payload["services"] = [
        {
            "service_name": row.service_name,
            "image_env_var": row.image_env_var,
            "tag_prefix": row.tag_prefix,
            "current_tag": row.current_tag,
        }
        for row in services
    ]
    return payload


async def _relay_agent_sse(
    agent: AgentClient,
    path: str,
    params: dict[str, Any] | None = None,
) -> AsyncIterator[bytes]:
    async for chunk in agent.stream(path, params=params):
        yield chunk


def _validate_db_fields(body: CreateProjectBody) -> None:
    if body.database_mode == "none":
        return
    db_name = body.db_name or default_db_name(body.slug)
    db_user = body.db_user or default_db_user(db_name)
    validate_sql_ident(db_name)
    validate_sql_ident(db_user)


async def _build_nginx_and_apply(
    db: DbSession,
    agent: AgentClient,
    project: Project,
) -> None:
    hostnames = db.scalars(
        select(ProjectHostname).where(ProjectHostname.project_slug == project.slug)
    ).all()
    routes = db.scalars(select(ProjectRoute).where(ProjectRoute.project_slug == project.slug)).all()
    allocations = db.scalars(
        select(PortAllocation).where(PortAllocation.project_slug == project.slug)
    ).all()
    ports = {row.env_var: row.host_port for row in allocations}
    spec = _nginx_spec(project, list(hostnames), list(routes), ports)
    await agent.post("/v1/nginx/sites", json={"spec": spec})


@router.post("", status_code=202)
async def create_project(
    body: CreateProjectBody,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    _validate_db_fields(body)
    docker_hub_repo = body.docker_hub_repo
    if docker_hub_repo is not None:
        try:
            docker_hub_repo = validate_docker_hub_repo(docker_hub_repo)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if db.get(Project, body.slug) is not None:
        raise HTTPException(status_code=409, detail="project already exists")
    for hostname in body.hostnames:
        if db.get(Domain, hostname.domain) is None:
            raise HTTPException(status_code=404, detail="domain not registered")

    db_name = body.db_name
    db_user = body.db_user
    if body.database_mode != "none":
        db_name = db_name or default_db_name(body.slug)
        db_user = db_user or default_db_user(db_name)

    state = initial_creation_state()
    project = Project(
        slug=body.slug,
        display_name=body.display_name,
        repo_url=body.repo,
        branch=body.branch,
        compose_file=body.compose_file,
        deploy_mode=body.deploy_mode,
        docker_hub_repo=docker_hub_repo,
        database_mode=body.database_mode,
        db_name=db_name,
        db_user=db_user,
        write_database_url=body.write_database_url,
        migration_command=None,
        migration_service=None,
        health_check_url=None,
        user_env=body.user_env,
        creation_state=json.dumps(state),
        created_at=_now(request),
    )
    db.add(project)
    for hostname in body.hostnames:
        db.add(
            ProjectHostname(
                project_slug=body.slug,
                domain=hostname.domain,
                subdomain=hostname.subdomain,
                kind=hostname.kind,
            )
        )
    for route in body.routes:
        db.add(
            ProjectRoute(
                project_slug=body.slug,
                path_prefix=route.path_prefix,
                port_env_var=route.port_env_var,
            )
        )
    for service in body.services:
        db.add(
            ProjectService(
                project_slug=body.slug,
                service_name=service.service_name,
                image_env_var=service.image_env_var,
                tag_prefix=service.tag_prefix,
                current_tag=None,
            )
        )
    db.commit()

    async def _background_creation() -> None:
        if db_module.SessionLocal is None:
            return
        try:
            with db_module.SessionLocal() as session:
                await run_creation(session, agent, body.slug)
        finally:
            _creation_tasks.pop(body.slug, None)

    task = asyncio.create_task(_background_creation())
    _creation_tasks[body.slug] = task

    return {"slug": body.slug, "creation_state": state}


@utility_router.get("/databases")
async def list_adoptable_databases(
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> list[dict[str, Any]]:
    result = await agent.get("/v1/db/databases")
    if not isinstance(result, list):
        raise HTTPException(status_code=502, detail="invalid databases response from agent")
    return [row for row in result if row.get("attached_slug") is None]


@router.get("")
async def list_projects(
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
) -> list[dict[str, Any]]:
    rows = db.scalars(select(Project).order_by(Project.slug)).all()
    return [_project_payload(row) for row in rows]


@router.get("/{slug}")
async def get_project(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return _project_detail_payload(db, project)


@router.patch("/{slug}")
async def patch_project(
    slug: str,
    body: PatchProjectBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(project, key, value)
    db.commit()
    db.refresh(project)
    return _project_detail_payload(db, project)


@router.get("/{slug}/compose-services")
async def get_compose_services(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.get(f"/v1/projects/{slug}/compose-services")


@router.put("/{slug}/services")
async def put_project_services(
    slug: str,
    body: PutServicesBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if has_running_deploy(db, slug):
        raise HTTPException(status_code=409, detail="deploy already running")

    existing = db.scalars(select(ProjectService).where(ProjectService.project_slug == slug)).all()
    tags_by_env = {row.image_env_var: row.current_tag for row in existing}

    db.execute(delete(ProjectService).where(ProjectService.project_slug == slug))
    for service in body.services:
        db.add(
            ProjectService(
                project_slug=slug,
                service_name=service.service_name,
                image_env_var=service.image_env_var,
                tag_prefix=service.tag_prefix,
                current_tag=tags_by_env.get(service.image_env_var),
            )
        )
    db.commit()
    db.refresh(project)
    return _project_detail_payload(db, project)


@router.get("/{slug}/compose/ps")
async def get_compose_ps(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.get(f"/v1/projects/{slug}/compose/ps")


@router.get("/{slug}/logs")
async def stream_project_logs(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
    service: str | None = None,
    tail: int = Query(200, ge=1, le=5000),
    follow: int = Query(1, ge=0, le=1),
) -> StreamingResponse:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    params: dict[str, Any] = {"tail": str(tail), "follow": str(follow)}
    if service is not None:
        params["service"] = service
    return StreamingResponse(
        _relay_agent_sse(agent, f"/v1/projects/{slug}/compose/logs", params=params),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/{slug}/compose/restart")
async def compose_restart(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.post(f"/v1/projects/{slug}/compose/restart")


@router.get("/{slug}/dumps/{name}")
async def download_dump(
    slug: str,
    name: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> StreamingResponse:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return StreamingResponse(
        _relay_agent_sse(agent, f"/v1/db/dumps/{slug}/{name}"),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/{slug}/retry-create", status_code=202)
async def retry_create(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    state = json.loads(project.creation_state)
    if state.get("status") == "ready":
        raise HTTPException(status_code=409, detail="creation not retryable")
    if state.get("status") == "running" and slug in _creation_tasks:
        raise HTTPException(status_code=409, detail="creation not retryable")
    if slug in _creation_tasks:
        raise HTTPException(status_code=409, detail="creation not retryable")

    async def _background_retry() -> None:
        if db_module.SessionLocal is None:
            return
        try:
            with db_module.SessionLocal() as session:
                await run_creation(session, agent, slug)
        finally:
            _creation_tasks.pop(slug, None)

    task = asyncio.create_task(_background_retry())
    _creation_tasks[slug] = task
    return {"slug": slug, "creation_state": json.loads(project.creation_state)}


@router.get("/{slug}/deploy-key")
async def get_deploy_key(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    state = json.loads(project.creation_state)
    return {"public_key": state.get("public_key")}


@router.post("/test-access")
async def test_access(
    body: TestAccessBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> Any:
    project = db.get(Project, body.slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    state = json.loads(project.creation_state)
    register = next(s for s in state["steps"] if s["name"] == "register")
    if register["status"] != "done":
        raise HTTPException(status_code=404, detail="project not registered on agent")
    return await agent.post(f"/v1/projects/{body.slug}/test-access")


@router.get("/{slug}/env")
async def get_project_env(
    slug: str,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    session: Annotated[Session, Depends(current_session)],
    reveal: bool = Query(default=False),
) -> Any:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if reveal:
        await require_step_up(request, session)
        return await agent.get(f"/v1/projects/{slug}/env", params={"reveal": "true"})
    return await agent.get(f"/v1/projects/{slug}/env")


@router.put("/{slug}/env")
async def put_project_env(
    slug: str,
    body: PutEnvBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.put(f"/v1/projects/{slug}/env", json={"content": body.content})


@router.patch("/{slug}/env")
async def patch_project_env(
    slug: str,
    body: PatchEnvBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.patch(
        f"/v1/projects/{slug}/env",
        json={"set": body.set, "unset": body.unset},
    )


@router.delete("/{slug}", status_code=204)
async def delete_project(
    slug: str,
    body: DeleteProjectBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
) -> Response:
    if body.confirm != slug:
        raise HTTPException(status_code=400, detail="confirm must match slug")
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    hostnames = db.scalars(
        select(ProjectHostname).where(ProjectHostname.project_slug == slug)
    ).all()

    await agent.delete(f"/v1/projects/{slug}", json={"confirm": slug})

    if body.drop_database and project.db_name:
        await agent.post(
            "/v1/db/drop",
            json={
                "db_name": project.db_name,
                "confirm": project.db_name,
                "drop_role": True,
            },
        )

    if body.remove_dns:
        for row in hostnames:
            fqdn = hostname_fqdn(row.domain, row.subdomain)
            await agent.post("/v1/dns/records/delete", json={"fqdn": fqdn})

    db.execute(delete(ProjectHostname).where(ProjectHostname.project_slug == slug))
    db.execute(delete(ProjectRoute).where(ProjectRoute.project_slug == slug))
    db.execute(delete(PortAllocation).where(PortAllocation.project_slug == slug))
    db.execute(delete(Deploy).where(Deploy.project_slug == slug))
    db.execute(delete(ProjectService).where(ProjectService.project_slug == slug))
    db.delete(project)
    db.commit()
    return Response(status_code=204)


@router.put("/{slug}/routing")
async def put_routing(
    slug: str,
    body: PutRoutingBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, str]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    old_hostnames = db.scalars(
        select(ProjectHostname).where(ProjectHostname.project_slug == slug)
    ).all()
    old_fqdns = {hostname_fqdn(row.domain, row.subdomain) for row in old_hostnames}

    for hostname in body.hostnames:
        if db.get(Domain, hostname.domain) is None:
            raise HTTPException(status_code=404, detail="domain not registered")

    db.execute(delete(ProjectHostname).where(ProjectHostname.project_slug == slug))
    db.execute(delete(ProjectRoute).where(ProjectRoute.project_slug == slug))

    new_fqdns: set[str] = set()
    for hostname in body.hostnames:
        db.add(
            ProjectHostname(
                project_slug=slug,
                domain=hostname.domain,
                subdomain=hostname.subdomain,
                kind=hostname.kind,
            )
        )
        new_fqdns.add(hostname_fqdn(hostname.domain, hostname.subdomain))

    existing_ports = {
        row.env_var: row
        for row in db.scalars(
            select(PortAllocation).where(PortAllocation.project_slug == slug)
        ).all()
    }

    for route in body.routes:
        db.add(
            ProjectRoute(
                project_slug=slug,
                path_prefix=route.path_prefix,
                port_env_var=route.port_env_var,
                max_body_mb=route.max_body_mb,
                read_timeout_s=route.read_timeout_s,
                send_timeout_s=route.send_timeout_s,
                streaming=route.streaming,
                websocket=route.websocket,
                pass_authorization=route.pass_authorization,
            )
        )
        if route.port_env_var not in existing_ports:
            result = await agent.post(
                "/v1/ports/allocate",
                json={"owner": slug, "env_var": route.port_env_var},
            )
            allocation = PortAllocation(
                project_slug=slug,
                env_var=route.port_env_var,
                host_port=int(result["port"]),
            )
            db.add(allocation)
            existing_ports[route.port_env_var] = allocation

    # Every allocated route port must exist in the project .env: compose binds
    # ${PORT_VAR} and nginx proxies to the allocated host port. Skipping this
    # leaves the route pointing at an unbound port (silent 502).
    env_sets: dict[str, str] = {}
    for route in body.routes:
        allocation = existing_ports[route.port_env_var]
        env_sets[route.port_env_var] = str(allocation.host_port)
    await agent.patch(
        f"/v1/projects/{slug}/env",
        json={"set": env_sets, "unset": []},
    )

    db.commit()

    await _build_nginx_and_apply(db, agent, project)

    for fqdn in new_fqdns - old_fqdns:
        await agent.post("/v1/dns/records/upsert", json={"fqdn": fqdn, "adopt": False})

    for fqdn in old_fqdns - new_fqdns:
        await agent.post("/v1/dns/records/delete", json={"fqdn": fqdn})

    return {"status": "ok"}


@router.post("/{slug}/database/rotate")
async def rotate_database_password(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, bool]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if not project.db_user or project.database_mode == "none":
        raise HTTPException(status_code=400, detail="project has no database user")

    result = await agent.post("/v1/db/rotate-password", json={"db_user": project.db_user})
    password = result.get("password")
    if not isinstance(password, str):
        raise HTTPException(status_code=502, detail="invalid rotate response from agent")

    set_values: dict[str, str] = {"POSTGRES_PASSWORD": password}
    if project.write_database_url:
        db_name = project.db_name or default_db_name(slug)
        encoded = quote(password, safe="")
        set_values["DATABASE_URL"] = (
            f"postgresql://{project.db_user}:{encoded}@postgres-central:5432/{db_name}"
        )

    await agent.patch(
        f"/v1/projects/{slug}/env",
        json={"set": set_values, "unset": []},
    )
    return {"restart_required": True}


@router.get("/{slug}/dumps")
async def list_dumps(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.get(f"/v1/db/dumps/{slug}")
