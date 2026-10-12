from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf, require_step_up
from vpscp_panel.models import Session
from vpscp_panel.panel_events import panel_audited

router = APIRouter(prefix="/api/settings", tags=["settings"])

_REGISTRY_SECRET_FIELDS = frozenset({"token"})


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


class RegistryCredentialsBody(BaseModel):
    username: str
    token: str

    @field_validator("username", "token")
    @classmethod
    def non_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value


@router.get("/registry")
async def get_registry_status(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    return await agent.get("/v1/registry/status")


@router.post("/registry")
async def set_registry_credentials(
    body: RegistryCredentialsBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    params = {"username": body.username}
    with panel_audited(
        db,
        "registry.set_credentials",
        params,
        extra_secret_fields=_REGISTRY_SECRET_FIELDS,
    ):
        return await agent.post(
            "/v1/registry/credentials",
            json={"username": body.username, "token": body.token},
        )
