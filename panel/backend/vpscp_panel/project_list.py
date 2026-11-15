from __future__ import annotations

import asyncio
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.deploy_ops import project_creation_ready
from vpscp_panel.models import Deploy, Project, ProjectHostname, ProjectRoute
from vpscp_panel.project_creation import hostname_fqdn
from vpscp_panel.project_runtime import runtime_status_from_ps


def _last_deploy_payload(row: Deploy) -> dict[str, Any]:
    return {
        "id": row.id,
        "status": row.status,
        "started_at": row.started_at.isoformat(),
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


def _latest_deploys(db: DbSession, slugs: list[str]) -> dict[str, Deploy]:
    if not slugs:
        return {}
    rows = db.scalars(
        select(Deploy)
        .where(Deploy.project_slug.in_(slugs))
        .order_by(Deploy.project_slug, Deploy.id.desc())
    ).all()
    latest: dict[str, Deploy] = {}
    for row in rows:
        if row.project_slug not in latest:
            latest[row.project_slug] = row
    return latest


def _routing_maps(
    db: DbSession,
    slugs: list[str],
) -> tuple[dict[str, list[ProjectHostname]], dict[str, list[ProjectRoute]]]:
    if not slugs:
        return {}, {}
    hostnames = db.scalars(
        select(ProjectHostname).where(ProjectHostname.project_slug.in_(slugs))
    ).all()
    routes = db.scalars(select(ProjectRoute).where(ProjectRoute.project_slug.in_(slugs))).all()
    host_by_slug: dict[str, list[ProjectHostname]] = {slug: [] for slug in slugs}
    route_by_slug: dict[str, list[ProjectRoute]] = {slug: [] for slug in slugs}
    for row in hostnames:
        host_by_slug.setdefault(row.project_slug, []).append(row)
    for row in routes:
        route_by_slug.setdefault(row.project_slug, []).append(row)
    return host_by_slug, route_by_slug


def primary_url(hostnames: list[ProjectHostname], routes: list[ProjectRoute]) -> str | None:
    primary = next((row for row in hostnames if row.kind == "primary"), None)
    if primary is None:
        return None
    route = next((row for row in routes if row.path_prefix), None)
    if route is None:
        return None
    fqdn = hostname_fqdn(primary.domain, primary.subdomain)
    prefix = route.path_prefix
    if not prefix.startswith("/"):
        prefix = f"/{prefix}"
    return f"https://{fqdn}{prefix}"


async def _compose_ps_map(agent: AgentClient, ready_slugs: list[str]) -> dict[str, Any | None]:
    if not ready_slugs:
        return {}

    async def fetch(slug: str) -> tuple[str, Any | None]:
        try:
            return slug, await agent.get(f"/v1/projects/{slug}/compose/ps")
        except AgentError:
            return slug, None

    pairs = await asyncio.gather(*(fetch(slug) for slug in ready_slugs))
    return dict(pairs)


async def enrich_project_summaries(
    db: DbSession,
    agent: AgentClient,
    projects: list[Project],
    base_payloads: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    slugs = [project.slug for project in projects]
    latest_deploys = _latest_deploys(db, slugs)
    host_by_slug, route_by_slug = _routing_maps(db, slugs)
    ready_slugs = [project.slug for project in projects if project_creation_ready(project)]
    ps_by_slug = await _compose_ps_map(agent, ready_slugs)

    enriched: list[dict[str, Any]] = []
    for project, payload in zip(projects, base_payloads, strict=True):
        slug = project.slug
        creation_state = json.loads(project.creation_state)
        creation_status = creation_state.get("status")
        last_deploy = latest_deploys.get(slug)
        last_payload = _last_deploy_payload(last_deploy) if last_deploy else None
        has_deploy = last_deploy is not None

        row = {
            **payload,
            "primary_url": primary_url(
                host_by_slug.get(slug, []),
                route_by_slug.get(slug, []),
            ),
            "last_deploy": last_payload,
        }
        if creation_status != "ready":
            row["runtime_status"] = None
        else:
            row["runtime_status"] = runtime_status_from_ps(
                ps_by_slug.get(slug),
                has_deploy=has_deploy,
            )
        enriched.append(row)
    return enriched
