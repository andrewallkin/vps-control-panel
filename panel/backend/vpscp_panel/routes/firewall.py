from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, require_csrf, require_step_up
from vpscp_panel.client_ip import client_ip
from vpscp_panel.models import Session

router = APIRouter(prefix="/api/firewall", tags=["firewall"])


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


class AddRuleBody(BaseModel):
    port: int | str
    proto: str
    action: str
    source: str
    comment: str = ""


class RuleIdentityBody(BaseModel):
    to: str
    proto: str
    action: str
    from_: str = Field(alias="from")
    v6: bool
    comment: str = ""

    model_config = {"populate_by_name": True}


class CloudflareOnlyBody(BaseModel):
    on: bool


@router.get("/rules")
async def get_rules(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> list[dict[str, Any]]:
    return await agent.get("/v1/firewall/rules")


@router.get("/exposure")
async def get_exposure(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> list[dict[str, Any]]:
    return await agent.get("/v1/firewall/exposure")


@router.post("/rules")
async def post_rule(
    body: AddRuleBody,
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, str]:
    return await agent.post("/v1/firewall/rules", json=body.model_dump())


@router.delete("/rules/{number}")
async def delete_rule(
    number: int,
    body: RuleIdentityBody,
    request: Request,
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, str]:
    ip = client_ip(request)
    payload = body.model_dump(by_alias=True)
    await agent.delete(
        f"/v1/firewall/rules/{number}",
        json=payload,
        params={"client_ip": ip},
    )
    return {"status": "ok"}


@router.post("/cloudflare-only")
async def post_cloudflare_only(
    body: CloudflareOnlyBody,
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, str]:
    return await agent.post("/v1/firewall/cloudflare-only", json=body.model_dump())
