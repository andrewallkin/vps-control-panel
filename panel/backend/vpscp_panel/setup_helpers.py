from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.auth import STEP_UP_DURATION
from vpscp_panel.models import Domain, Session
from vpscp_panel.settings_store import get_setting, set_setting

SSL_MODE_WARNING = "Set SSL/TLS mode to Full (strict) in Cloudflare."


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def is_stepped_up(session: Session, now: datetime) -> bool:
    if session.stepped_up_at is None:
        return False
    until = as_utc(session.stepped_up_at) + STEP_UP_DURATION
    return until > now


def load_setup(db: DbSession) -> dict[str, Any]:
    raw = get_setting(db, "setup")
    if not isinstance(raw, dict):
        return {"database": "pending", "completed": False}
    setup = dict(raw)
    if "database" not in setup:
        setup["database"] = "pending"
    if "completed" not in setup:
        setup["completed"] = False
    return setup


def save_setup(db: DbSession, setup: dict[str, Any]) -> None:
    set_setting(db, "setup", setup)
    db.commit()


def public_setup_state(setup: dict[str, Any], db: DbSession) -> dict[str, Any]:
    domain_count = db.scalar(select(func.count()).select_from(Domain)) or 0
    panel_hostname = get_setting(db, "panel_hostname")
    cloudflare_done = setup.get("cloudflare") == "done"
    return {
        "steps": [
            {"id": "account", "status": "done"},
            {"id": "database", "status": setup["database"]},
            {"id": "cloudflare", "status": "done" if cloudflare_done else "pending"},
            {"id": "domains", "status": "done" if domain_count > 0 else "pending"},
            {
                "id": "panel_hostname",
                "status": "done" if panel_hostname else "pending",
            },
        ],
        "completed": setup["completed"],
        "restore_job_id": setup.get("restore_job_id"),
    }


def require_step_up_if_completed(
    request: Request,
    db: DbSession,
    session: Session,
) -> None:
    setup = load_setup(db)
    now = request.app.state.clock()
    if setup.get("completed") is True and not is_stepped_up(session, now):
        raise HTTPException(status_code=403, detail="step_up_required")


def panel_hostname_uses_domain(panel_hostname: str, domain: str) -> bool:
    if panel_hostname == domain:
        return True
    suffix = f".{domain}"
    if not panel_hostname.endswith(suffix):
        return False
    label = panel_hostname[: -len(suffix)]
    return "." not in label


def tls_row_to_cert_fields(row: dict[str, Any]) -> tuple[str, str | None]:
    if not row.get("exists"):
        return "missing", None
    return "valid", row.get("not_after")
