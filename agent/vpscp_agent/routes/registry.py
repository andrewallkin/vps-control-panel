from __future__ import annotations

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from vpscp_agent import audit
from vpscp_agent.registry import (
    list_registry_tags,
    registry_status,
    set_credentials,
    validate_registry_token,
    validate_registry_username,
)

router = APIRouter(tags=["registry"])


class RegistryCredentialsBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    token: str = Field(min_length=1, max_length=200)


@router.post("/v1/registry/credentials")
def post_registry_credentials(body: RegistryCredentialsBody, request: Request) -> dict[str, bool]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    username = validate_registry_username(body.username)
    token = validate_registry_token(body.token)
    with audit.audited(
        db,
        "registry.set_credentials",
        {"username": username},
    ):
        set_credentials(settings, runner, username, token, app=request.app)
    return {"ok": True}


@router.get("/v1/registry/status")
def get_registry_status(request: Request) -> dict[str, object]:
    settings = request.app.state.settings
    return registry_status(settings)


@router.get("/v1/registry/tags")
def get_registry_tags(
    request: Request,
    repo: str = Query(..., min_length=1),
    prefix: str = Query(..., min_length=1),
    branch: str = Query(..., min_length=1),
) -> list[dict[str, object]]:
    settings = request.app.state.settings
    return list_registry_tags(
        settings,
        repo=repo,
        prefix=prefix,
        branch=branch,
        app=request.app,
    )
