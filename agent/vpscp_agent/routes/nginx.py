from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel

from vpscp_agent import audit
from vpscp_agent.hostnames import claim_hostnames, release_site
from vpscp_agent.nginx_apply import (
    CloudflareIpFetcher,
    apply_site,
    ensure_base_config,
    list_nginx_sites,
    remove_site,
    validate_site_id,
)
from vpscp_agent.nginx_render import SiteSpec, render_site

router = APIRouter(tags=["nginx"])


class NginxSiteBody(BaseModel):
    spec: SiteSpec


def _site_fqdns(db, site_id: str) -> list[str]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT fqdn FROM hostname WHERE site = ? ORDER BY fqdn",
            (site_id,),
        ).fetchall()
    return [row["fqdn"] for row in rows]


def _rollback_hostnames(db, site_id: str, previous: list[str]) -> None:
    if previous:
        claim_hostnames(db, site_id, previous)
    else:
        release_site(db, site_id)


def _cloudflare_fetcher(request: Request) -> CloudflareIpFetcher | None:
    return getattr(request.app.state, "cloudflare_ip_fetcher", None)


@router.get("/v1/nginx/sites")
def get_nginx_sites(request: Request) -> list[dict[str, list[str] | str]]:
    return list_nginx_sites(request.app.state.db)


@router.post("/v1/nginx/sites")
def post_nginx_site(body: NginxSiteBody, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    spec = body.spec
    validate_site_id(spec.site_id)
    previous = _site_fqdns(db, spec.site_id)
    params = {"site_id": spec.site_id, "hostnames": [h.fqdn for h in spec.hostnames]}
    with audit.audited(db, "nginx.site.apply", params):
        try:
            claim_hostnames(db, spec.site_id, [h.fqdn for h in spec.hostnames])
            content = render_site(spec)
            apply_site(spec.site_id, content, settings=settings, runner=runner)
        except Exception:
            _rollback_hostnames(db, spec.site_id, previous)
            raise
    return {"site_id": spec.site_id}


@router.delete("/v1/nginx/sites/{site_id}")
def delete_nginx_site(
    site_id: Annotated[str, ...],
    request: Request,
) -> dict[str, str]:
    validate_site_id(site_id)
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    params = {"site_id": site_id}
    with audit.audited(db, "nginx.site.remove", params):
        remove_site(site_id, settings=settings, runner=runner, db=db)
    return {"site_id": site_id}


@router.post("/v1/nginx/refresh-cloudflare-ips")
def post_refresh_cloudflare_ips(request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    fetch = _cloudflare_fetcher(request)
    with audit.audited(db, "nginx.cloudflare_ips.refresh", {}):
        ensure_base_config(
            settings=settings,
            runner=runner,
            db=db,
            fetch=fetch,
            force_fetch=True,
        )
    return {"status": "ok"}


@router.post("/v1/nginx/ensure-base")
def post_ensure_base(request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    fetch = _cloudflare_fetcher(request)
    with audit.audited(db, "nginx.base.ensure", {}):
        ensure_base_config(
            settings=settings,
            runner=runner,
            db=db,
            fetch=fetch,
        )
    return {"status": "ok"}
