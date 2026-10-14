from __future__ import annotations

import asyncio
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.models import (
    PortAllocation,
    Project,
    ProjectHostname,
    ProjectRoute,
    ProjectService,
)
from vpscp_panel.project_env import build_project_env_content
from vpscp_panel.validation import (
    tag_prefix_from_docker_image_env,
    validate_service_name,
    validate_sql_ident,
)


def initial_creation_state() -> dict[str, Any]:
    return {
        "status": "running",
        "steps": [
            {"name": "register", "status": "pending", "error": None},
            {"name": "deploy_key", "status": "pending", "error": None},
            {"name": "clone", "status": "pending", "error": None},
            {"name": "ports", "status": "pending", "error": None},
            {"name": "database", "status": "pending", "error": None},
            {"name": "env", "status": "pending", "error": None},
            {"name": "nginx", "status": "pending", "error": None},
            {"name": "dns", "status": "pending", "error": None},
        ],
        "public_key": None,
        "ports": {},
        "db_password": None,
    }


def default_db_name(slug: str) -> str:
    return slug.replace("-", "_")


def default_db_user(db_name: str) -> str:
    return f"{db_name}_user"


def resolve_db_identifiers(project: Project) -> tuple[str | None, str | None]:
    if project.database_mode == "none":
        return None, None
    db_name = project.db_name or default_db_name(project.slug)
    db_user = project.db_user or default_db_user(db_name)
    validate_sql_ident(db_name)
    validate_sql_ident(db_user)
    return db_name, db_user


def _load_state(project: Project) -> dict[str, Any]:
    return json.loads(project.creation_state)


def _save_state(db: Session, project: Project, state: dict[str, Any]) -> None:
    project.creation_state = json.dumps(state)
    db.add(project)
    db.commit()


def _step_by_name(state: dict[str, Any], name: str) -> dict[str, Any]:
    for step in state["steps"]:
        if step["name"] == name:
            return step
    raise KeyError(name)


def _needs_deploy_key_confirmation(project: Project, state: dict[str, Any]) -> bool:
    if not project.repo_url.startswith("git@github.com:"):
        return False
    if state.get("deploy_key_confirmed"):
        return False
    return _step_by_name(state, "deploy_key")["status"] == "done"


def hostname_fqdn(domain: str, subdomain: str) -> str:
    if subdomain == "":
        return domain
    return f"{subdomain}.{domain}"


def _nginx_spec(
    project: Project,
    hostnames: list[ProjectHostname],
    routes: list[ProjectRoute],
    ports: dict[str, int],
) -> dict[str, Any]:
    return {
        "site_id": project.slug,
        "panel": False,
        "hostnames": [
            {
                "fqdn": hostname_fqdn(row.domain, row.subdomain),
                "domain": row.domain,
                "kind": row.kind,
            }
            for row in hostnames
        ],
        "routes": [
            {
                "path": row.path_prefix,
                "port": ports[row.port_env_var],
                "max_body_mb": row.max_body_mb,
                "read_timeout_s": row.read_timeout_s,
                "send_timeout_s": row.send_timeout_s,
                "streaming": row.streaming,
                "websocket": row.websocket,
                "pass_authorization": row.pass_authorization,
            }
            for row in routes
        ],
    }


def insert_discovered_compose_services(
    db: Session,
    slug: str,
    compose_payload: dict[str, Any],
) -> None:
    existing = db.scalars(select(ProjectService).where(ProjectService.project_slug == slug)).all()
    if existing:
        return

    used_names = {row.service_name for row in existing}
    used_env_vars = {row.image_env_var for row in existing}
    services = compose_payload.get("services")
    if not isinstance(services, list):
        return

    added = False
    for entry in services:
        if not isinstance(entry, dict):
            continue
        image_var = entry.get("image_var")
        if not isinstance(image_var, str):
            continue
        tag_prefix = tag_prefix_from_docker_image_env(image_var)
        if tag_prefix is None:
            continue
        name = entry.get("name")
        if not isinstance(name, str):
            continue
        try:
            validate_service_name(name)
        except ValueError:
            continue
        if name in used_names or image_var in used_env_vars:
            continue
        db.add(
            ProjectService(
                project_slug=slug,
                service_name=name,
                image_env_var=image_var,
                tag_prefix=tag_prefix,
                current_tag=None,
            )
        )
        used_names.add(name)
        used_env_vars.add(image_var)
        added = True
    if added:
        db.commit()


async def _poll_job(agent: AgentClient, job_id: str) -> None:
    while True:
        result = await agent.get(f"/v1/jobs/{job_id}")
        status = result.get("status")
        if status != "running":
            if status == "failed":
                detail = result.get("error") or "clone job failed"
                raise AgentError(502, str(detail))
            return
        await asyncio.sleep(0.2)


async def run_creation(db: Session, agent: AgentClient, slug: str) -> None:
    project = db.get(Project, slug)
    if project is None:
        return

    try:
        db_name, db_user = resolve_db_identifiers(project)
    except ValueError as exc:
        state = _load_state(project)
        state["status"] = "failed"
        step = _step_by_name(state, "register")
        step["status"] = "failed"
        step["error"] = str(exc)
        _save_state(db, project, state)
        return

    hostnames = db.scalars(
        select(ProjectHostname).where(ProjectHostname.project_slug == slug)
    ).all()
    routes = db.scalars(select(ProjectRoute).where(ProjectRoute.project_slug == slug)).all()

    state = _load_state(project)
    state["status"] = "running"
    _save_state(db, project, state)

    step_handlers: list[tuple[str, Any]] = [
        ("register", _step_register),
        ("deploy_key", _step_deploy_key),
        ("clone", _step_clone),
        ("ports", _step_ports),
        ("database", _step_database),
        ("env", _step_env),
        ("nginx", _step_nginx),
        ("dns", _step_dns),
    ]

    ctx = {
        "db_name": db_name,
        "db_user": db_user,
        "hostnames": hostnames,
        "routes": routes,
    }

    for step_name, handler in step_handlers:
        step = _step_by_name(state, step_name)
        if step["status"] == "done":
            continue
        if step_name == "clone" and _needs_deploy_key_confirmation(project, state):
            step["status"] = "pending"
            step["error"] = None
            state["status"] = "awaiting_deploy_key"
            _save_state(db, project, state)
            return
        try:
            await handler(db, agent, project, state, ctx)
            step["status"] = "done"
            step["error"] = None
        except Exception as exc:  # noqa: BLE001
            step["status"] = "failed"
            step["error"] = str(exc)
            state["status"] = "failed"
            _save_state(db, project, state)
            return
        _save_state(db, project, state)

    state["status"] = "ready"
    state["db_password"] = None
    _save_state(db, project, state)


async def _step_register(
    _db: Session,
    agent: AgentClient,
    project: Project,
    _state: dict[str, Any],
    _ctx: dict[str, Any],
) -> None:
    await agent.post(
        "/v1/projects",
        json={
            "slug": project.slug,
            "repo_url": project.repo_url,
            "branch": project.branch,
            "compose_file": project.compose_file,
            "deploy_mode": project.deploy_mode,
        },
    )


async def _step_deploy_key(
    _db: Session,
    agent: AgentClient,
    project: Project,
    state: dict[str, Any],
    _ctx: dict[str, Any],
) -> None:
    if not project.repo_url.startswith("git@github.com:"):
        return
    result = await agent.post(f"/v1/projects/{project.slug}/deploy-key")
    state["public_key"] = result.get("public_key")


async def _step_clone(
    db: Session,
    agent: AgentClient,
    project: Project,
    _state: dict[str, Any],
    _ctx: dict[str, Any],
) -> None:
    result = await agent.post(f"/v1/projects/{project.slug}/clone")
    job_id = result["job_id"]
    await _poll_job(agent, job_id)
    if project.deploy_mode != "image":
        return
    existing = db.scalars(
        select(ProjectService).where(ProjectService.project_slug == project.slug)
    ).all()
    if existing:
        return
    compose_payload = await agent.get(f"/v1/projects/{project.slug}/compose-services")
    insert_discovered_compose_services(db, project.slug, compose_payload)


async def _step_ports(
    db: Session,
    agent: AgentClient,
    project: Project,
    state: dict[str, Any],
    ctx: dict[str, Any],
) -> None:
    ports: dict[str, int] = dict(state.get("ports") or {})
    for route in ctx["routes"]:
        env_var = route.port_env_var
        if env_var in ports:
            continue
        existing = db.scalars(
            select(PortAllocation).where(
                PortAllocation.project_slug == project.slug,
                PortAllocation.env_var == env_var,
            )
        ).first()
        if existing is not None:
            ports[env_var] = existing.host_port
            continue
        result = await agent.post(
            "/v1/ports/allocate",
            json={"owner": project.slug, "env_var": env_var},
        )
        host_port = int(result["port"])
        db.add(
            PortAllocation(
                project_slug=project.slug,
                env_var=env_var,
                host_port=host_port,
            )
        )
        db.commit()
        ports[env_var] = host_port
    state["ports"] = ports


async def _step_database(
    _db: Session,
    agent: AgentClient,
    project: Project,
    state: dict[str, Any],
    ctx: dict[str, Any],
) -> None:
    if project.database_mode == "none":
        return
    db_name = ctx["db_name"]
    db_user = ctx["db_user"]
    assert db_name is not None and db_user is not None
    if project.database_mode == "new":
        result = await agent.post(
            "/v1/db/create",
            json={"slug": project.slug, "db_name": db_name, "db_user": db_user},
        )
        state["db_password"] = result.get("password")
    elif project.database_mode == "adopted":
        result = await agent.post(
            "/v1/db/adopt",
            json={
                "slug": project.slug,
                "db_name": db_name,
                "db_user": db_user,
                "password_mode": "rotate",
                "password": None,
            },
        )
        password = result.get("password")
        if isinstance(password, str):
            state["db_password"] = password


async def _step_env(
    _db: Session,
    agent: AgentClient,
    project: Project,
    state: dict[str, Any],
    ctx: dict[str, Any],
) -> None:
    content = build_project_env_content(
        user_env=project.user_env,
        database_mode=project.database_mode,
        db_name=ctx["db_name"],
        db_user=ctx["db_user"],
        db_password=state.get("db_password"),
        write_database_url=project.write_database_url,
        ports=state.get("ports") or {},
    )
    await agent.put(f"/v1/projects/{project.slug}/env", json={"content": content})


async def _step_nginx(
    _db: Session,
    agent: AgentClient,
    project: Project,
    state: dict[str, Any],
    ctx: dict[str, Any],
) -> None:
    spec = _nginx_spec(project, ctx["hostnames"], ctx["routes"], state.get("ports") or {})
    await agent.post("/v1/nginx/sites", json={"spec": spec})


async def _step_dns(
    _db: Session,
    agent: AgentClient,
    project: Project,
    _state: dict[str, Any],
    ctx: dict[str, Any],
) -> None:
    for row in ctx["hostnames"]:
        fqdn = hostname_fqdn(row.domain, row.subdomain)
        await agent.post("/v1/dns/records/upsert", json={"fqdn": fqdn, "adopt": False})
