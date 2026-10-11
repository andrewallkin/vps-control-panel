from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

import vpscp_panel.db as db_module
from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf, require_step_up
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
    DomainName,
    EnvKey,
    RepoUrl,
    RoutePath,
    Slug,
    SqlIdent,
    Subdomain,
    validate_docker_hub_repo,
    validate_sql_ident,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])
utility_router = APIRouter(prefix="/api", tags=["projects"])


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
        return self


class DeleteProjectBody(BaseModel):
    confirm: str
    drop_database: bool = False
    remove_dns: bool = False


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
    max_body_mb: int = 25
    read_timeout_s: int = 60
    send_timeout_s: int = 60
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
    db.commit()

    async def _background_creation() -> None:
        if db_module.SessionLocal is None:
            return
        with db_module.SessionLocal() as session:
            await run_creation(session, agent, body.slug)

    asyncio.create_task(_background_creation())

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
    return _project_payload(project)


@router.post("/{slug}/retry-create")
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
    if state.get("status") in ("ready", "running"):
        raise HTTPException(status_code=409, detail="creation not retryable")
    await run_creation(db, agent, slug)
    db.refresh(project)
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
