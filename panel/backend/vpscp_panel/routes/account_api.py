from datetime import datetime
from typing import Annotated

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.auth import (
    _as_utc,
    _settings,
    current_session,
    get_db,
    require_csrf,
    require_step_up,
)
from vpscp_panel.config import PanelSettings
from vpscp_panel.models import AdminUser, Session
from vpscp_panel.panel_events import panel_audited
from vpscp_panel.security import (
    decrypt_secret,
    encrypt_secret,
    hash_password,
    verify_password,
    verify_totp,
)

router = APIRouter(prefix="/api/account", tags=["account"])


def _now(request: Request) -> datetime:
    return request.app.state.clock()


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str
    code: str

    @field_validator("new_password")
    @classmethod
    def check_new_password(cls, value: str) -> str:
        if len(value) < 12:
            raise ValueError("password must be at least 12 characters")
        return value


class TotpConfirmBody(BaseModel):
    code: str


@router.post("/password")
def change_password(
    body: PasswordChangeBody,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
    settings: Annotated[PanelSettings, Depends(_settings)],
) -> dict[str, bool]:
    now = _now(request)
    admin = db.get(AdminUser, session.admin_id)
    if admin is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not verify_password(admin.password_hash, body.current_password):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not verify_totp(admin, body.code, now, settings=settings):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    with panel_audited(db, "account.password_change", {"username": admin.username}):
        admin.password_hash = hash_password(body.new_password)
        db.commit()
    return {"ok": True}


@router.post("/totp/reset")
def reset_totp(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    settings: Annotated[PanelSettings, Depends(_settings)],
) -> dict[str, str]:
    admin = db.get(AdminUser, session.admin_id)
    if admin is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    secret = pyotp.random_base32()
    admin.totp_pending_enc = encrypt_secret(settings, secret)
    db.commit()
    uri = f"otpauth://totp/vpscp:{admin.username}?secret={secret}&issuer=vpscp"
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/totp/confirm")
def confirm_totp(
    body: TotpConfirmBody,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
    settings: Annotated[PanelSettings, Depends(_settings)],
) -> dict[str, bool]:
    now = _now(request)
    admin = db.get(AdminUser, session.admin_id)
    if admin is None or not admin.totp_pending_enc:
        raise HTTPException(status_code=400, detail="no pending TOTP reset")
    pending = decrypt_secret(settings, admin.totp_pending_enc)
    totp = pyotp.TOTP(pending)
    if not totp.verify(body.code, for_time=_as_utc(now), valid_window=1):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    with panel_audited(db, "account.totp_switch", {"username": admin.username}):
        admin.totp_secret_enc = admin.totp_pending_enc
        admin.totp_pending_enc = None
        admin.totp_last_step = None
        db.commit()
    return {"ok": True}


@router.get("/sessions")
def list_sessions(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(current_session)],
) -> list[dict]:
    rows = db.scalars(
        select(Session).where(Session.admin_id == session.admin_id).order_by(Session.id)
    ).all()
    return [
        {
            "id": row.id,
            "created_at": _as_utc(row.created_at).isoformat(),
            "last_seen_at": _as_utc(row.last_seen_at).isoformat(),
            "ip": row.ip,
            "user_agent": row.user_agent,
            "current": row.id == session.id,
        }
        for row in rows
    ]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: int,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
) -> None:
    row = db.get(Session, session_id)
    if row is None or row.admin_id != session.admin_id:
        raise HTTPException(status_code=404, detail="session not found")
    db.delete(row)
    db.commit()
