from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from vpscp_agent import audit
from vpscp_agent.cloudflare import MANAGED_BY_COMMENT, CloudflareClient
from vpscp_agent.credentials import read_cloudflare_token, write_cloudflare_ini
from vpscp_agent.domains import zone_for_fqdn
from vpscp_agent.validation import DomainName

router = APIRouter(tags=["dns"])

CloudflareClientFactory = Callable[..., CloudflareClient]


class DnsCredentialsBody(BaseModel):
    token: str = Field(min_length=1)


class DnsRecordBody(BaseModel):
    fqdn: DomainName


class DnsUpsertBody(DnsRecordBody):
    adopt: bool = False


class ZoneSummary(BaseModel):
    id: str
    name: str
    status: str


class DnsCredentialsResponse(BaseModel):
    zones: list[ZoneSummary]


class SslModeResponse(BaseModel):
    mode: str | None


def _get_setting(db, key: str) -> str | None:
    with db.connect() as conn:
        row = conn.execute("SELECT value FROM agent_setting WHERE key = ?", (key,)).fetchone()
    return None if row is None else row["value"]


def _client_factory(request: Request) -> CloudflareClientFactory:
    factory = getattr(request.app.state, "cloudflare_client_factory", None)
    if factory is not None:
        return factory
    settings = request.app.state.settings
    base_url = settings.cloudflare_api_base
    return lambda token, transport=None: CloudflareClient(
        token, base_url=base_url, transport=transport
    )


def _client_from_token(request: Request, token: str) -> CloudflareClient:
    transport = getattr(request.app.state, "cloudflare_transport", None)
    return _client_factory(request)(token, transport=transport)


def _configured_client(request: Request) -> CloudflareClient:
    settings = request.app.state.settings
    token = read_cloudflare_token(settings)
    if not token:
        raise ValueError("Cloudflare credentials are not configured")
    return _client_from_token(request, token)


def _zone_records_for_fqdn(request: Request, fqdn: str) -> tuple[str, CloudflareClient]:
    db = request.app.state.db
    zone_id = zone_for_fqdn(db, fqdn)
    if zone_id is None:
        raise ValueError(f"fqdn not under a registered domain: {fqdn!r}")
    return zone_id, _configured_client(request)


@router.post("/v1/dns/credentials")
def post_dns_credentials(body: DnsCredentialsBody, request: Request) -> DnsCredentialsResponse:
    db = request.app.state.db
    settings = request.app.state.settings
    params = {"token": body.token}
    with audit.audited(
        db,
        "dns.credentials.set",
        params,
        extra_secret_fields=frozenset({"token"}),
    ):
        client = _client_from_token(request, body.token)
        client.verify()
        zones = client.list_zones()
        write_cloudflare_ini(settings, body.token)
    return DnsCredentialsResponse(zones=[ZoneSummary(**zone) for zone in zones])


@router.get("/v1/dns/zones")
def get_dns_zones(request: Request) -> list[ZoneSummary]:
    client = _configured_client(request)
    return [ZoneSummary(**zone) for zone in client.list_zones()]


@router.get("/v1/dns/zones/{zone_id}/ssl-mode")
def get_dns_ssl_mode(zone_id: str, request: Request) -> SslModeResponse:
    client = _configured_client(request)
    return SslModeResponse(mode=client.get_ssl_mode(zone_id))


@router.post("/v1/dns/records/upsert")
def post_dns_upsert(body: DnsUpsertBody, request: Request) -> dict[str, Any]:
    db = request.app.state.db
    params = {"fqdn": body.fqdn, "adopt": body.adopt}
    with audit.audited(db, "dns.record.upsert", params):
        public_ipv4 = _get_setting(db, "public_ipv4")
        if not public_ipv4:
            raise ValueError("public_ipv4 is not configured")
        zone_id, client = _zone_records_for_fqdn(request, body.fqdn)
        at_name = client.find_dns_records_at_name(zone_id, body.fqdn)
        for row in at_name:
            if row.get("type") != "A":
                raise ValueError(f"existing DNS record is not type A: {body.fqdn!r}")
        existing = next((row for row in at_name if row.get("type") == "A"), None)
        if (
            existing is not None
            and existing.get("comment") != MANAGED_BY_COMMENT
            and not body.adopt
        ):
            raise ValueError(
                f"existing DNS record is not managed by vpscp; pass adopt=true to take over: {body.fqdn!r}"
            )
        record = client.upsert_a_record(zone_id, body.fqdn, public_ipv4)
    return record


@router.post("/v1/dns/records/delete", status_code=204)
def post_dns_delete(body: DnsRecordBody, request: Request) -> Response:
    db = request.app.state.db
    params = {"fqdn": body.fqdn}
    with audit.audited(db, "dns.record.delete", params):
        zone_id, client = _zone_records_for_fqdn(request, body.fqdn)
        existing = client.find_a_record(zone_id, body.fqdn)
        if existing is None:
            return Response(status_code=204)
        if existing.get("comment") != MANAGED_BY_COMMENT:
            raise ValueError(
                f"refusing to delete DNS record without {MANAGED_BY_COMMENT!r} comment: {body.fqdn!r}"
            )
        client.delete_a_record(zone_id, body.fqdn)
    return Response(status_code=204)
