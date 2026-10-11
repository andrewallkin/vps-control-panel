import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.auth import current_session, get_db
from vpscp_panel.models import Project, Session

router = APIRouter(tags=["dashboard"])


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


def _now(request: Request) -> datetime:
    return request.app.state.clock()


def _parse_schedule_hours(raw: str) -> list[int]:
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return sorted({int(p) for p in parts})


def _backup_threshold_hours(schedule_hours: str) -> float:
    hours = _parse_schedule_hours(schedule_hours)
    if not hours:
        return 48.0
    if len(hours) == 1:
        max_gap = 24.0
    else:
        gaps = [hours[i + 1] - hours[i] for i in range(len(hours) - 1)]
        gaps.append(24 - hours[-1] + hours[0])
        max_gap = float(max(gaps))
    return 2.0 * max_gap


def _parse_finished_at(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _backup_overdue(last_run: Any, schedule_hours: str | None, now: datetime) -> bool:
    if schedule_hours is None:
        return False
    if last_run is None:
        return True
    if not isinstance(last_run, dict):
        return True
    finished_at = _parse_finished_at(last_run.get("finished_at"))
    if finished_at is None:
        return True
    try:
        threshold = _backup_threshold_hours(schedule_hours)
    except ValueError:
        return False
    elapsed = (now - finished_at).total_seconds() / 3600.0
    return elapsed > threshold


def _backup_failed(last_run: Any) -> bool:
    return isinstance(last_run, dict) and last_run.get("success") is False


def _agent_unreachable(exc: AgentError) -> bool:
    return exc.status == 503 and exc.detail == "agent unavailable"


def _ready_project_slugs(db: DbSession) -> list[str]:
    slugs: list[str] = []
    for project in db.scalars(select(Project)).all():
        state = json.loads(project.creation_state)
        if state.get("status") == "ready":
            slugs.append(project.slug)
    return slugs


def _classify_compose_ps(ps: Any) -> str | None:
    if not isinstance(ps, dict):
        return "unhealthy"
    services = ps.get("services")
    if not isinstance(services, list):
        return "unhealthy"
    if not services:
        return None
    for svc in services:
        if not isinstance(svc, dict):
            return "unhealthy"
        if svc.get("state") != "running":
            return "unhealthy"
        if svc.get("health") == "unhealthy":
            return "unhealthy"
    return "up"


async def _project_counts(
    agent: AgentClient,
    db: DbSession,
) -> dict[str, int]:
    slugs = _ready_project_slugs(db)
    total = len(slugs)
    up = 0
    unhealthy = 0
    for slug in slugs:
        try:
            ps = await agent.get(f"/v1/projects/{slug}/compose/ps")
        except AgentError:
            unhealthy += 1
            continue
        kind = _classify_compose_ps(ps)
        if kind == "up":
            up += 1
        elif kind == "unhealthy":
            unhealthy += 1
    return {"total": total, "up": up, "unhealthy": unhealthy}


def _empty_summary() -> dict[str, Any]:
    return {
        "backup": None,
        "warnings": [
            {
                "level": "critical",
                "code": "agent_unreachable",
                "message": "Agent unreachable",
            }
        ],
        "projects": {"total": 0, "up": 0, "unhealthy": 0},
        "nearest_cert_expiry": None,
    }


def _schedule_hours_from_settings(settings: Any) -> str | None:
    if not isinstance(settings, dict):
        return None
    raw = settings.get("schedule_hours")
    if not isinstance(raw, str):
        return None
    stripped = raw.strip()
    if not stripped:
        return None
    try:
        hours = _parse_schedule_hours(stripped)
    except ValueError:
        return None
    if not hours:
        return None
    return stripped


@router.get("/api/dashboard/summary")
async def dashboard_summary(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    now = _now(request)

    metrics: Any = None
    metrics_unreachable = False
    try:
        metrics = await agent.get("/v1/metrics/current")
    except AgentError as exc:
        if _agent_unreachable(exc):
            metrics_unreachable = True

    status: Any = None
    status_unreachable = False
    try:
        status = await agent.get("/v1/backup/status")
    except AgentError as exc:
        if _agent_unreachable(exc):
            status_unreachable = True

    schedule_hours: str | None = None
    settings_unreachable = False
    try:
        settings = await agent.get("/v1/backup/settings")
        schedule_hours = _schedule_hours_from_settings(settings)
    except AgentError as exc:
        if _agent_unreachable(exc):
            settings_unreachable = True

    agent_unreachable = metrics_unreachable or status_unreachable or settings_unreachable
    agent_reachable = not metrics_unreachable or not status_unreachable or not settings_unreachable
    if agent_unreachable and not agent_reachable:
        return _empty_summary()

    backup: dict[str, Any] | None = None
    if isinstance(status, dict):
        last_run = status.get("last_run")
        backup = {
            "last_run": last_run,
            "overdue": _backup_overdue(last_run, schedule_hours, now),
            "failed": _backup_failed(last_run),
        }

    warnings: list[dict[str, str]] = []
    disks = metrics.get("disks") if isinstance(metrics, dict) else None
    if isinstance(disks, list):
        for disk in disks:
            if not isinstance(disk, dict):
                continue
            percent = disk.get("percent")
            path = disk.get("path", "")
            if isinstance(percent, (int, float)) and percent > 85:
                warnings.append(
                    {
                        "level": "warning",
                        "code": "disk_high",
                        "message": f"Disk usage above 85% on {path}",
                    }
                )

    mem_percent = metrics.get("mem_percent") if isinstance(metrics, dict) else None
    if isinstance(mem_percent, (int, float)) and mem_percent > 90:
        warnings.append({"level": "warning", "code": "memory_high", "message": "Memory above 90%"})

    if backup is not None:
        if backup["failed"]:
            warnings.append(
                {"level": "critical", "code": "backup_failed", "message": "Backup failed"}
            )
        if backup["overdue"]:
            warnings.append(
                {"level": "warning", "code": "backup_overdue", "message": "Backup overdue"}
            )

    if agent_unreachable and agent_reachable:
        warnings.append(
            {
                "level": "critical",
                "code": "agent_unreachable",
                "message": "Agent unreachable",
            }
        )

    nearest_cert_expiry: str | None = None
    try:
        tls_rows = await agent.get("/v1/tls/status")
    except AgentError:
        tls_rows = None
    if isinstance(tls_rows, list):
        nearest_dt: datetime | None = None
        for row in tls_rows:
            if not isinstance(row, dict) or not row.get("exists"):
                continue
            not_after = _parse_finished_at(row.get("not_after"))
            if not_after is None:
                continue
            if nearest_dt is None or not_after < nearest_dt:
                nearest_dt = not_after
        if nearest_dt is not None:
            nearest_cert_expiry = nearest_dt.isoformat()
            if nearest_dt - now < timedelta(days=14):
                warnings.append(
                    {
                        "level": "warning",
                        "code": "cert_expiring_soon",
                        "message": "A TLS certificate expires in under 14 days",
                    }
                )

    projects = await _project_counts(agent, db)

    return {
        "backup": backup,
        "warnings": warnings,
        "projects": projects,
        "nearest_cert_expiry": nearest_cert_expiry,
    }
