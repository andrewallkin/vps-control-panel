from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

import vpscp_panel.db as db_module
from vpscp_panel.config import PanelSettings
from vpscp_panel.models import AdminUser, Session
from vpscp_panel.security import (
    dummy_password_hash,
    new_token,
    token_hash,
    verify_password,
    verify_totp,
)
from vpscp_panel.settings_store import get_setting

SESSION_COOKIE = "vpscp_session"
IDLE_TIMEOUT = timedelta(hours=2)
ABSOLUTE_TIMEOUT = timedelta(hours=12)
STEP_UP_DURATION = timedelta(minutes=5)
LOCKOUT_DURATION = timedelta(minutes=15)
MAX_FAILED_ATTEMPTS = 5


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str
    code: str


class StepUpBody(BaseModel):
    code: str


def _now(request: Request) -> datetime:
    clock = request.app.state.clock
    return clock()


def get_db() -> DbSession:
    if db_module.SessionLocal is None:
        raise RuntimeError("Database has not been initialized")
    db = db_module.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _settings(request: Request) -> PanelSettings:
    return request.app.state.settings


def _cookie_kwargs(settings: PanelSettings) -> dict:
    return {
        "key": SESSION_COOKIE,
        "httponly": True,
        "samesite": "strict",
        "path": "/",
        "secure": settings.panel_cookie_secure,
    }


def _stepped_up_until(session: Session, now: datetime) -> str | None:
    if session.stepped_up_at is None:
        return None
    until = _as_utc(session.stepped_up_at) + STEP_UP_DURATION
    if until <= now:
        return None
    return until.isoformat()


def _setup_complete(db: DbSession) -> bool:
    setup = get_setting(db, "setup")
    return isinstance(setup, dict) and setup.get("completed") is True


def _same_origin(request: Request, url: str) -> bool:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return False
    base = f"{request.url.scheme}://{request.url.netloc}"
    return f"{parsed.scheme}://{parsed.netloc}" == base


def _check_login_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    if origin is None and referer is None:
        return
    if origin is not None and not _same_origin(request, origin):
        raise HTTPException(status_code=403, detail="bad_origin")
    if referer is not None and not _same_origin(request, referer):
        raise HTTPException(status_code=403, detail="bad_origin")


def _locked_json(admin: AdminUser, now: datetime) -> JSONResponse:
    assert admin.locked_until is not None
    remaining = int((_as_utc(admin.locked_until) - now).total_seconds())
    retry = max(1, remaining)
    return JSONResponse(
        status_code=429,
        content={"detail": "locked", "retry_after_seconds": retry},
    )


def _register_failed_attempt(admin: AdminUser, now: datetime, db: DbSession) -> JSONResponse | None:
    admin.failed_attempts += 1
    if admin.failed_attempts >= MAX_FAILED_ATTEMPTS:
        admin.locked_until = now + LOCKOUT_DURATION
        admin.failed_attempts = 0
        db.commit()
        return _locked_json(admin, now)
    db.commit()
    return None


def _clear_lockout_state(admin: AdminUser, db: DbSession) -> None:
    admin.failed_attempts = 0
    admin.locked_until = None
    db.commit()


def _session_expired(session: Session, now: datetime) -> bool:
    if now - _as_utc(session.last_seen_at) > IDLE_TIMEOUT:
        return True
    return now - _as_utc(session.created_at) > ABSOLUTE_TIMEOUT


async def current_session(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
) -> Session:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="unauthorized")
    now = _now(request)
    row = db.scalar(select(Session).where(Session.token_hash == token_hash(token)))
    if row is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    if _session_expired(row, now):
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=401, detail="unauthorized")
    row.last_seen_at = now
    db.commit()
    request.state.session = row
    return row


async def require_csrf(
    request: Request,
    session: Annotated[Session, Depends(current_session)],
) -> Session:
    header = request.headers.get("X-CSRF-Token")
    if header is None or header != session.csrf_token:
        raise HTTPException(status_code=403, detail="csrf_failed")
    return session


async def require_step_up(
    request: Request,
    session: Annotated[Session, Depends(current_session)],
) -> Session:
    now = _now(request)
    if _stepped_up_until(session, now) is None:
        raise HTTPException(status_code=403, detail="step_up_required")
    return session


def _create_session(
    db: DbSession,
    admin: AdminUser,
    request: Request,
    now: datetime,
) -> tuple[str, Session]:
    raw_token = new_token()
    csrf = new_token()
    user_agent = request.headers.get("user-agent") or ""
    client = request.client
    ip = client.host if client is not None else ""
    row = Session(
        token_hash=token_hash(raw_token),
        admin_id=admin.id,
        csrf_token=csrf,
        created_at=now,
        last_seen_at=now,
        stepped_up_at=None,
        user_agent=user_agent,
        ip=ip,
    )
    db.add(row)
    db.commit()
    return raw_token, row


@router.post("/login")
def login(
    body: LoginBody,
    request: Request,
    response: Response,
    db: Annotated[DbSession, Depends(get_db)],
    settings: Annotated[PanelSettings, Depends(_settings)],
) -> dict[str, str]:
    _check_login_origin(request)
    now = _now(request)
    admin = db.scalar(select(AdminUser).where(AdminUser.username == body.username))

    if admin is not None and admin.locked_until is not None and _as_utc(admin.locked_until) > now:
        return _locked_json(admin, now)

    password_hash = admin.password_hash if admin is not None else dummy_password_hash()
    password_ok = verify_password(password_hash, body.password)

    if admin is None or not password_ok:
        if admin is not None:
            locked = _register_failed_attempt(admin, now, db)
            if locked is not None:
                return locked
        raise HTTPException(status_code=401, detail="invalid_credentials")

    if not verify_totp(admin, body.code, now, settings=settings):
        locked = _register_failed_attempt(admin, now, db)
        if locked is not None:
            return locked
        raise HTTPException(status_code=401, detail="invalid_credentials")

    _clear_lockout_state(admin, db)
    raw_token, row = _create_session(db, admin, request, now)
    response.set_cookie(value=raw_token, **_cookie_kwargs(settings))
    return {"username": admin.username, "csrf_token": row.csrf_token}


@router.get("/me")
def me(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(current_session)],
) -> dict:
    admin = db.get(AdminUser, session.admin_id)
    if admin is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    now = _now(request)
    return {
        "username": admin.username,
        "csrf_token": session.csrf_token,
        "stepped_up_until": _stepped_up_until(session, now),
        "setup_complete": _setup_complete(db),
    }


@router.post("/logout")
def logout(
    response: Response,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
    settings: Annotated[PanelSettings, Depends(_settings)],
) -> dict[str, bool]:
    db.delete(session)
    db.commit()
    response.delete_cookie(**_cookie_kwargs(settings))
    return {"ok": True}


@router.post("/step-up")
def step_up(
    body: StepUpBody,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
    settings: Annotated[PanelSettings, Depends(_settings)],
) -> dict[str, str | None]:
    now = _now(request)
    admin = db.get(AdminUser, session.admin_id)
    if admin is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not verify_totp(admin, body.code, now, settings=settings):
        locked = _register_failed_attempt(admin, now, db)
        if locked is not None:
            return locked
        raise HTTPException(status_code=401, detail="invalid_credentials")
    session.stepped_up_at = now
    db.commit()
    return {"stepped_up_until": _stepped_up_until(session, now)}
