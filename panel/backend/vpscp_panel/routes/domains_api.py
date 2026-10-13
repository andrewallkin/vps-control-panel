import ipaddress
from collections import defaultdict
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.auth import current_session, get_db, require_csrf
from vpscp_panel.models import Domain, Project, ProjectHostname, Session
from vpscp_panel.project_creation import hostname_fqdn
from vpscp_panel.panel_events import panel_audited
from vpscp_panel.routes.setup import require_setup_mutate
from vpscp_panel.settings_store import get_setting, set_setting
from vpscp_panel.setup_helpers import (
    SSL_MODE_WARNING,
    load_setup,
    panel_hostname_uses_domain,
    save_setup,
    tls_row_to_cert_fields,
)
from vpscp_panel.validation import DomainName, Subdomain, validate_acme_email

router = APIRouter(tags=["domains"])

_CF_NOT_CONFIGURED = "Cloudflare credentials are not configured"


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


class CloudflareTokenBody(BaseModel):
    token: str


class RegisterDomainBody(BaseModel):
    name: DomainName
    zone_id: str


class ServerSettingsUpdate(BaseModel):
    public_ipv4: str | None = None
    acme_email: str | None = None

    @field_validator("public_ipv4")
    @classmethod
    def check_public_ipv4(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ipaddress.IPv4Address(value)
        except ipaddress.AddressValueError as exc:
            raise ValueError(f"invalid public_ipv4: {value!r}") from exc
        return value

    @field_validator("acme_email")
    @classmethod
    def check_acme_email(cls, value: str | None) -> str | None:
        return validate_acme_email(value)


class PanelHostnameBody(BaseModel):
    domain: DomainName
    subdomain: Subdomain = ""


def _zones_response(zones: list[Any]) -> dict[str, Any]:
    return {"configured": True, "zones": zones}


@router.post("/api/cloudflare/token")
async def post_cloudflare_token(
    body: CloudflareTokenBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> dict[str, Any]:
    if not body.token.strip():
        raise HTTPException(status_code=400, detail="token must not be empty")
    with panel_audited(db, "cloudflare.set_token", {}):
        result = await agent.post("/v1/dns/credentials", json={"token": body.token})
    zones = result.get("zones", [])
    setup = load_setup(db)
    setup["cloudflare"] = "done"
    save_setup(db, setup)
    return _zones_response(zones)


@router.get("/api/cloudflare/zones")
async def get_cloudflare_zones(
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> dict[str, Any]:
    try:
        zones = await agent.get("/v1/dns/zones")
    except AgentError as exc:
        if exc.status == 400 and exc.detail == _CF_NOT_CONFIGURED:
            return {"configured": False, "zones": []}
        raise
    return _zones_response(zones)


async def _sync_tls_into_db(db: DbSession, agent: AgentClient) -> dict[str, dict[str, Any]]:
    try:
        rows = await agent.get("/v1/tls/status")
    except AgentError:
        return {}
    if not isinstance(rows, list):
        return {}
    by_domain: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("domain")
        if not isinstance(name, str):
            continue
        by_domain[name] = row
        domain_row = db.get(Domain, name)
        if domain_row is None:
            continue
        cert_status, cert_expires_at = tls_row_to_cert_fields(row)
        domain_row.cert_status = cert_status
        domain_row.cert_expires_at = cert_expires_at
    db.commit()
    return by_domain


def _hostname_entry(
    fqdn: str,
    kind: str,
    *,
    project_slug: str | None = None,
    project_name: str | None = None,
) -> dict[str, Any]:
    return {
        "fqdn": fqdn,
        "kind": kind,
        "project_slug": project_slug,
        "project_name": project_name,
    }


def _build_zone_hostnames(
    domain_name: str,
    panel_hostname: str | None,
    project_rows: list[tuple[ProjectHostname, Project]],
) -> list[dict[str, Any]]:
    by_fqdn: dict[str, dict[str, Any]] = {}

    for ph, project in project_rows:
        fqdn = hostname_fqdn(ph.domain, ph.subdomain)
        by_fqdn[fqdn] = _hostname_entry(
            fqdn,
            ph.kind,
            project_slug=project.slug,
            project_name=project.display_name,
        )

    if domain_name not in by_fqdn:
        by_fqdn[domain_name] = _hostname_entry(domain_name, "zone")

    if panel_hostname and panel_hostname_uses_domain(panel_hostname, domain_name):
        if panel_hostname in by_fqdn:
            if by_fqdn[panel_hostname]["kind"] == "zone":
                by_fqdn[panel_hostname] = _hostname_entry(panel_hostname, "panel")
        else:
            by_fqdn[panel_hostname] = _hostname_entry(panel_hostname, "panel")

    hostnames = list(by_fqdn.values())

    def _sort_key(entry: dict[str, Any]) -> tuple[int, str]:
        if entry["kind"] == "zone":
            return (0, entry["fqdn"])
        return (1, entry["fqdn"])

    hostnames.sort(key=_sort_key)
    return hostnames


async def _ssl_mode_for_zone(
    agent: AgentClient, zone_id: str
) -> tuple[str | None, str | None]:
    try:
        result = await agent.get(f"/v1/dns/zones/{zone_id}/ssl-mode")
    except AgentError:
        return None, None
    if not isinstance(result, dict):
        return None, None
    mode = result.get("mode")
    ssl_mode = mode if isinstance(mode, str) else None
    error = result.get("error")
    ssl_mode_error = "permission" if error == "permission" else None
    return ssl_mode, ssl_mode_error


@router.get("/api/domains")
async def list_domains(
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> list[dict[str, Any]]:
    tls_by_domain = await _sync_tls_into_db(db, agent)
    rows = db.scalars(select(Domain).order_by(Domain.name)).all()

    panel_raw = get_setting(db, "panel_hostname")
    panel_hostname = panel_raw if isinstance(panel_raw, str) and panel_raw else None

    project_by_domain: dict[str, list[tuple[ProjectHostname, Project]]] = defaultdict(list)
    hostname_rows = db.execute(
        select(ProjectHostname, Project).join(
            Project, ProjectHostname.project_slug == Project.slug
        )
    ).all()
    for ph, project in hostname_rows:
        project_by_domain[ph.domain].append((ph, project))

    items: list[dict[str, Any]] = []
    for row in rows:
        tls = tls_by_domain.get(row.name, {})
        cert_status, cert_expires_at = (
            tls_row_to_cert_fields(tls)
            if tls
            else (
                row.cert_status or "missing",
                row.cert_expires_at,
            )
        )
        ssl_mode, ssl_mode_error = await _ssl_mode_for_zone(agent, row.zone_id)
        warning = None
        if ssl_mode is not None and ssl_mode != "strict":
            warning = SSL_MODE_WARNING
        items.append(
            {
                "name": row.name,
                "zone_id": row.zone_id,
                "cert_status": cert_status,
                "cert_expires_at": cert_expires_at,
                "ssl_mode": ssl_mode,
                "ssl_mode_error": ssl_mode_error,
                "warning": warning,
                "hostnames": _build_zone_hostnames(
                    row.name,
                    panel_hostname,
                    project_by_domain.get(row.name, []),
                ),
            }
        )
    return items


@router.post("/api/domains")
async def register_domain(
    body: RegisterDomainBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    if not body.zone_id.strip():
        raise HTTPException(status_code=400, detail="zone_id must not be empty")
    await agent.post("/v1/domains", json={"name": body.name, "zone_id": body.zone_id})
    db.merge(
        Domain(
            name=body.name,
            zone_id=body.zone_id,
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    db.commit()
    try:
        issue = await agent.post("/v1/tls/issue", json={"domain": body.name})
    except AgentError as exc:
        return {"job_id": None, "issue_error": str(exc.detail)}
    return {"job_id": issue["job_id"], "issue_error": None}


@router.delete("/api/domains/{name}", status_code=204)
async def delete_domain(
    name: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> None:
    panel_hostname = get_setting(db, "panel_hostname")
    if isinstance(panel_hostname, str) and panel_hostname_uses_domain(panel_hostname, name):
        raise HTTPException(status_code=409, detail="domain_in_use_by_panel_hostname")
    row = db.get(Domain, name)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not registered")
    await agent.delete(f"/v1/domains/{name}")
    db.delete(row)
    db.commit()


@router.post("/api/domains/{name}/reissue")
async def reissue_domain(
    name: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, str]:
    if db.get(Domain, name) is None:
        raise HTTPException(status_code=404, detail="domain not registered")
    issue = await agent.post("/v1/tls/issue", json={"domain": name})
    return {"job_id": issue["job_id"]}


@router.get("/api/server-settings")
async def get_server_settings(
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> dict[str, Any]:
    return await agent.get("/v1/server/settings")


@router.put("/api/server-settings")
async def put_server_settings(
    body: ServerSettingsUpdate,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> dict[str, Any]:
    payload = body.model_dump(exclude_unset=True)
    with panel_audited(db, "server.update_settings", payload):
        return await agent.put("/v1/server/settings", json=payload)


def _panel_fqdn(domain: str, subdomain: str) -> str:
    if subdomain == "":
        return domain
    return f"{subdomain}.{domain}"


@router.get("/api/panel-hostname")
async def get_panel_hostname(
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
) -> dict[str, str | None]:
    raw = get_setting(db, "panel_hostname")
    if isinstance(raw, str) and raw:
        return {"panel_hostname": raw}
    return {"panel_hostname": None}


@router.post("/api/panel-hostname")
async def set_panel_hostname(
    body: PanelHostnameBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, str]:
    if db.get(Domain, body.domain) is None:
        raise HTTPException(status_code=404, detail="domain not registered")
    fqdn = _panel_fqdn(body.domain, body.subdomain)
    spec = {
        "site_id": "vpscp-panel",
        "panel": True,
        "hostnames": [
            {"fqdn": fqdn, "domain": body.domain, "kind": "primary"},
        ],
        "routes": [
            {
                "path": "/",
                "port": 8080,
                "max_body_mb": 32,
                "read_timeout_s": 3600,
            }
        ],
    }
    await agent.post("/v1/nginx/sites", json={"spec": spec})
    await agent.post("/v1/dns/records/upsert", json={"fqdn": fqdn})
    set_setting(db, "panel_hostname", fqdn)
    db.commit()
    return {"panel_hostname": fqdn}
