from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf
from vpscp_panel.deploy_ops import (
    deploy_row_payload,
    has_running_deploy,
    project_creation_ready,
    run_deploy,
)
from vpscp_panel.models import Deploy, Project, ProjectService, Session

router = APIRouter(prefix="/api", tags=["deploys"])


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


def _now(request: Request):
    return request.app.state.clock()


class StartDeployBody(BaseModel):
    tags: dict[str, str] | None = None
    build: bool = False

    @model_validator(mode="after")
    def tags_or_build(self) -> StartDeployBody:
        if self.build and self.tags is not None:
            raise ValueError("cannot specify both tags and build")
        if not self.build and self.tags is None:
            raise ValueError("tags or build required")
        return self


@router.post("/projects/{slug}/deploy", status_code=202)
async def start_deploy(
    slug: str,
    body: StartDeployBody,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if not project_creation_ready(project):
        raise HTTPException(status_code=409, detail="project not ready")
    if body.build:
        if project.deploy_mode != "build":
            raise HTTPException(
                status_code=400, detail="build deploy not allowed for image project"
            )
        tags: dict[str, str] = {}
        trigger = "build"
    else:
        if project.deploy_mode != "image":
            raise HTTPException(
                status_code=400, detail="image deploy not allowed for build project"
            )
        tags = dict(body.tags or {})
        trigger = "deploy"
    if has_running_deploy(db, slug):
        raise HTTPException(status_code=409, detail="deploy already running")

    deploy = await run_deploy(
        db,
        agent,
        project,
        tags=tags,
        trigger=trigger,
        now=_now(request),
    )
    return {"id": deploy.id, "status": deploy.status}


@router.get("/projects/{slug}/deploys")
async def list_deploys(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
) -> list[dict[str, Any]]:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    rows = db.scalars(
        select(Deploy).where(Deploy.project_slug == slug).order_by(Deploy.id.desc())
    ).all()
    return [deploy_row_payload(row) for row in rows]


@router.get("/projects/{slug}/tags")
async def list_tags(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> dict[str, Any]:
    project = db.get(Project, slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    services = db.scalars(select(ProjectService).where(ProjectService.project_slug == slug)).all()
    out: list[dict[str, Any]] = []
    for svc in services:
        tags: list[Any] = []
        if project.docker_hub_repo is not None:
            tags = await agent.get(
                "/v1/registry/tags",
                params={
                    "repo": project.docker_hub_repo,
                    "prefix": svc.tag_prefix,
                    "branch": project.branch,
                },
            )
        out.append(
            {
                "service": svc.service_name,
                "image_env_var": svc.image_env_var,
                "tags": tags,
            }
        )
    return {"services": out}


@router.post("/deploys/{deploy_id}/redeploy", status_code=202)
async def redeploy(
    deploy_id: int,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    row = db.get(Deploy, deploy_id)
    if row is None:
        raise HTTPException(status_code=404, detail="deploy not found")
    if row.status != "succeeded":
        raise HTTPException(status_code=409, detail="deploy not redeployable")
    project = db.get(Project, row.project_slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if project.deploy_mode != "image":
        raise HTTPException(status_code=400, detail="redeploy not allowed for build project")
    if not project_creation_ready(project):
        raise HTTPException(status_code=409, detail="project not ready")
    if has_running_deploy(db, project.slug):
        raise HTTPException(status_code=409, detail="deploy already running")

    tags = json.loads(row.tags_json)
    if not isinstance(tags, dict):
        tags = {}
    tags = {str(k): str(v) for k, v in tags.items()}

    deploy = await run_deploy(
        db,
        agent,
        project,
        tags=tags,
        trigger="redeploy",
        now=_now(request),
    )
    return {"id": deploy.id, "status": deploy.status}
