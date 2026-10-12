from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field, field_validator

from vpscp_agent import audit
from vpscp_agent.firewall import (
    add_rule,
    cloudflare_only,
    delete_rule,
    exposure_report,
    list_rules,
)
from vpscp_agent.nginx_apply import CloudflareIpFetcher

router = APIRouter(tags=["firewall"])


class AddRuleBody(BaseModel):
    port: int | str
    proto: str
    action: str
    source: str
    comment: str = ""

    @field_validator("port")
    @classmethod
    def check_port(cls, value: int | str) -> int | str:
        from vpscp_agent.firewall import _validate_port

        return _validate_port(value)

    @field_validator("proto")
    @classmethod
    def check_proto(cls, value: str) -> str:
        from vpscp_agent.firewall import _validate_proto

        return _validate_proto(value)

    @field_validator("action")
    @classmethod
    def check_action(cls, value: str) -> str:
        from vpscp_agent.firewall import _validate_action

        return _validate_action(value)

    @field_validator("source")
    @classmethod
    def check_source(cls, value: str) -> str:
        from vpscp_agent.firewall import _validate_source

        return _validate_source(value)

    @field_validator("comment")
    @classmethod
    def check_comment(cls, value: str) -> str:
        from vpscp_agent.firewall import _validate_comment

        return _validate_comment(value)


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


@router.get("/v1/firewall/rules")
def get_rules(request: Request) -> list[dict]:
    return list_rules(request.app.state.runner)


@router.post("/v1/firewall/rules")
def post_rule(body: AddRuleBody, request: Request) -> dict[str, str]:
    runner = request.app.state.runner
    db = request.app.state.db
    params = body.model_dump()
    with audit.audited(db, "fw.add", params):
        add_rule(
            runner,
            port=body.port,
            proto=body.proto,
            action=body.action,
            source=body.source,
            comment=body.comment,
        )
    return {"status": "ok"}


@router.delete("/v1/firewall/rules/{number}")
def delete_rule_route(
    number: int,
    body: RuleIdentityBody,
    request: Request,
    client_ip: str | None = Query(None),
) -> dict[str, str]:
    runner = request.app.state.runner
    db = request.app.state.db
    expected = {
        "to": body.to,
        "proto": body.proto,
        "action": body.action,
        "from": body.from_,
        "v6": body.v6,
        "comment": body.comment,
    }
    params = {"number": number, "client_ip": client_ip, **expected}
    with audit.audited(db, "fw.delete", params):
        delete_rule(
            runner,
            db=db,
            number=number,
            client_ip=client_ip,
            expected=expected,
        )
    return {"status": "ok"}


@router.post("/v1/firewall/cloudflare-only")
def post_cloudflare_only(body: CloudflareOnlyBody, request: Request) -> dict[str, str]:
    runner = request.app.state.runner
    db = request.app.state.db
    fetch: CloudflareIpFetcher | None = getattr(request.app.state, "cloudflare_ip_fetcher", None)
    params = {"on": body.on}
    with audit.audited(db, "fw.cloudflare_only", params):
        cloudflare_only(runner, db, on=body.on, fetch=fetch)
    return {"status": "ok"}


@router.get("/v1/firewall/exposure")
def get_exposure(request: Request) -> list[dict]:
    return exposure_report(request.app.state.runner, request.app.state.db)
