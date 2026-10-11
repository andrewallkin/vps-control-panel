from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, model_validator

from vpscp_agent.deploy import (
    deploy_job_body,
    validate_deploy_health_url,
    validate_deploy_tags,
)
from vpscp_agent.jobs import JobLockedError
from vpscp_agent.validation import Slug, validate_project_slug

router = APIRouter(prefix="/v1/projects", tags=["deploy"])


class MigrationBody(BaseModel):
    service: str
    command: str


class DeployBody(BaseModel):
    tags: dict[str, str]
    mode: Literal["image", "build"]
    db: bool = False
    migration: MigrationBody | None = None
    health_url: str | None = None

    @model_validator(mode="after")
    def validate_tags_for_mode(self) -> DeployBody:
        validate_deploy_tags(self.mode, self.tags)
        return self


@router.post("/{slug}/deploy", status_code=202)
def post_deploy(slug: Slug, body: DeployBody, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    psql = request.app.state.psql
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    validate_deploy_health_url(db, slug, body.health_url)
    if body.db and jobs.is_locked("postgres"):
        raise JobLockedError("postgres")

    params: dict[str, object] = {
        "slug": slug,
        "mode": body.mode,
        "tags": body.tags,
        "db": body.db,
    }
    migration_dict: dict[str, str] | None = None
    if body.migration is not None:
        migration_dict = {"service": body.migration.service, "command": body.migration.command}
        params["migration"] = migration_dict
    if body.health_url is not None:
        params["health_url"] = body.health_url

    job = jobs.start(
        "project.deploy",
        params,
        deploy_job_body(
            settings,
            db,
            runner,
            psql,
            slug,
            tags=dict(body.tags),
            mode=body.mode,
            db_flag=body.db,
            migration=migration_dict,
            health_url=body.health_url,
        ),
        lock_key=f"deploy:{slug}",
    )
    return {"job_id": job.id}
