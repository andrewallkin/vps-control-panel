import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf, require_step_up
from vpscp_panel.models import Domain, Session

router = APIRouter(prefix="/api/cloudflare/rules", tags=["cloudflare-rules"])
_RULE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


class RulePlacement(BaseModel):
    kind: Literal["first", "last", "custom"]
    position: int | None = Field(default=None, ge=1)


class RuleBody(BaseModel):
    domain: str
    name: str
    description: str = ""
    expression: str
    action: str
    enabled: bool = True
    logging: bool = True
    skip: list[str] = Field(default_factory=list)
    placement: RulePlacement


def _require_domain(db: DbSession, domain: str) -> None:
    if db.get(Domain, domain) is None:
        raise HTTPException(status_code=404, detail="domain not registered")


def _rule_id(rule_id: str) -> str:
    if not _RULE_ID.fullmatch(rule_id):
        raise HTTPException(status_code=400, detail="invalid rule id")
    return rule_id


@router.get("")
async def list_rules(
    domain: Annotated[str, Query(min_length=1)],
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    _require_domain(db, domain)
    return await agent.get("/v1/cloudflare/rules", params={"domain": domain})


@router.post("")
async def create_rule(
    body: RuleBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    _require_domain(db, body.domain)
    return await agent.post("/v1/cloudflare/rules", json=body.model_dump())


@router.put("/{rule_id}")
async def update_rule(
    rule_id: str,
    body: RuleBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    _require_domain(db, body.domain)
    safe_id = _rule_id(rule_id)
    return await agent.put(f"/v1/cloudflare/rules/{safe_id}", json=body.model_dump())


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: str,
    domain: Annotated[str, Query(min_length=1)],
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, str]:
    _require_domain(db, domain)
    safe_id = _rule_id(rule_id)
    await agent.delete(f"/v1/cloudflare/rules/{safe_id}", params={"domain": domain})
    return {"status": "ok"}
