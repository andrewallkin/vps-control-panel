from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from vpscp_agent import audit
from vpscp_agent.cloudflare_rules import (
    RuleWrite,
    create_rule,
    delete_rule,
    list_rules,
    update_rule,
)
from vpscp_agent.credentials import read_cloudflare_token
from vpscp_agent.domains import list_domains
from vpscp_agent.routes.dns import _client_from_token
from vpscp_agent.validation import validate_domain

router = APIRouter(tags=["cloudflare-rules"])


class RuleBody(RuleWrite):
    domain: str


def _zone_and_client(request: Request, domain: str):
    validate_domain(domain)
    db = request.app.state.db
    match = next((row for row in list_domains(db) if row.name == domain), None)
    if match is None:
        raise ValueError(f"domain not registered: {domain!r}")
    token = read_cloudflare_token(request.app.state.settings)
    if not token:
        raise ValueError("Cloudflare credentials are not configured")
    return match.zone_id, _client_from_token(request, token)


class RulesResponse(BaseModel):
    rules: list[dict]
    error: str | None = None


@router.get("/v1/cloudflare/rules")
def get_rules(domain: str, request: Request) -> RulesResponse:
    zone_id, client = _zone_and_client(request, domain)
    result = list_rules(client, zone_id)
    return RulesResponse(rules=result["rules"], error=result["error"])


@router.post("/v1/cloudflare/rules")
def post_rule(body: RuleBody, request: Request) -> dict:
    db = request.app.state.db
    params = {"domain": body.domain, "name": body.name.strip(), "action": body.action}
    with audit.audited(db, "cloudflare.rule.create", params):
        zone_id, client = _zone_and_client(request, body.domain)
        return create_rule(client, zone_id, body)


@router.put("/v1/cloudflare/rules/{rule_id}")
def put_rule(rule_id: str, body: RuleBody, request: Request) -> dict:
    db = request.app.state.db
    params = {
        "domain": body.domain,
        "rule_id": rule_id,
        "name": body.name.strip(),
        "action": body.action,
    }
    with audit.audited(db, "cloudflare.rule.update", params):
        zone_id, client = _zone_and_client(request, body.domain)
        return update_rule(client, zone_id, rule_id, body)


@router.delete("/v1/cloudflare/rules/{rule_id}", status_code=204)
def remove_rule(rule_id: str, domain: str, request: Request) -> Response:
    db = request.app.state.db
    params = {"domain": domain, "rule_id": rule_id}
    with audit.audited(db, "cloudflare.rule.delete", params):
        zone_id, client = _zone_and_client(request, domain)
        delete_rule(client, zone_id, rule_id)
    return Response(status_code=204)
