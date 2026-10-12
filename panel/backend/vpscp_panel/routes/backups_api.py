from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf, require_step_up
from vpscp_panel.backup_schedule import compute_next_run
from vpscp_panel.models import Session
from vpscp_panel.panel_events import panel_audited
from vpscp_panel.routes.dashboard import _backup_overdue, _schedule_hours_from_settings

router = APIRouter(prefix="/api/backups", tags=["backups"])

_BACKUP_SECRET_FIELDS = frozenset({"service_account", "archive_passphrase"})


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


def _now(request: Request) -> datetime:
    return request.app.state.clock()


class BackupSettingsBody(BaseModel):
    service_account: str | None = None
    bucket: str
    schedule_hours: str
    schedule_minute: int = Field(ge=0, le=59)
    timezone: str
    retention_days: int = Field(ge=1, le=3650)
    archive_passphrase: str | None = None


class BackupTestBody(BaseModel):
    service_account: str | None = None
    bucket: str


@router.get("/settings")
async def get_backup_settings(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    return await agent.get("/v1/backup/settings")


@router.put("/settings")
async def put_backup_settings(
    body: BackupSettingsBody,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    payload = body.model_dump()
    unset_fields = body.model_dump(exclude_unset=True)
    needs_step_up = (
        "service_account" in unset_fields  # setting OR clearing credentials
        or "archive_passphrase" in unset_fields
    )
    if needs_step_up:
        await require_step_up(request, session)
    audit_params = {k: v for k, v in payload.items() if v is not None}
    with panel_audited(
        db,
        "backup.write_settings",
        audit_params,
        extra_secret_fields=_BACKUP_SECRET_FIELDS,
    ):
        return await agent.put("/v1/backup/settings", json=payload)


@router.post("/test")
async def post_backup_test(
    body: BackupTestBody,
    request: Request,
    session: Annotated[Session, Depends(require_csrf)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    if body.service_account:
        await require_step_up(request, session)
    return await agent.post("/v1/backup/test", json=body.model_dump())


@router.post("/run-now")
async def post_backup_run_now(
    _session: Annotated[Session, Depends(require_csrf)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    return await agent.post("/v1/backup/run-now")


@router.get("/status")
async def get_backup_status(
    request: Request,
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    now = _now(request)
    status = await agent.get("/v1/backup/status")
    if not isinstance(status, dict):
        raise HTTPException(status_code=502, detail="invalid backup status from agent")
    settings = await agent.get("/v1/backup/settings")
    schedule_hours: str | None = None
    next_run: str | None = None
    overdue = False
    if isinstance(settings, dict):
        schedule_hours = _schedule_hours_from_settings(settings)
        raw_hours = settings.get("schedule_hours")
        minute = settings.get("schedule_minute")
        tz_name = settings.get("timezone")
        if isinstance(raw_hours, str) and isinstance(minute, int) and isinstance(tz_name, str):
            nxt = compute_next_run(now, raw_hours, minute, tz_name)
            if nxt is not None:
                next_run = nxt.isoformat()
        last_run = status.get("last_run")
        overdue = _backup_overdue(last_run, schedule_hours, now)
    return {**status, "next_run": next_run, "overdue": overdue}
