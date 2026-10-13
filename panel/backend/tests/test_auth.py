from datetime import datetime, timedelta

import pyotp
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

import vpscp_panel.db as db_module
from vpscp_panel.auth import require_step_up
from vpscp_panel.config import PanelSettings
from vpscp_panel.main import create_app
from vpscp_panel.models import AdminUser
from vpscp_panel.settings_store import set_setting


def totp_code(secret: str, when: datetime | None = None) -> str:
    if when is None:
        return pyotp.TOTP(secret).now()
    return pyotp.TOTP(secret).at(when)


def login(client, admin_user, when: datetime | None = None) -> dict:
    code = totp_code(admin_user["totp_secret"], when)
    response = client.post(
        "/api/auth/login",
        json={
            "username": admin_user["username"],
            "password": admin_user["password"],
            "code": code,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_login_wrong_password(client, admin_user, frozen_time):
    code = totp_code(admin_user["totp_secret"], frozen_time)
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong-password", "code": code},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_credentials"}


def test_login_wrong_totp(client, admin_user, frozen_time):
    response = client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": admin_user["password"],
            "code": "000000",
        },
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_credentials"}


def test_login_unknown_user_does_not_500(client, frozen_time):
    response = client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "any-password-1", "code": "000000"},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_credentials"}


def test_lockout_on_fifth_failure(client, admin_user, frozen_time):
    code = totp_code(admin_user["totp_secret"], frozen_time)
    for _ in range(4):
        response = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong", "code": code},
        )
        assert response.status_code == 401
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong", "code": code},
    )
    assert response.status_code == 429
    body = response.json()
    assert body["detail"] == "locked"
    assert body["retry_after_seconds"] >= 1


def test_locked_returns_429_without_checking_credentials(
    client, admin_user, panel_settings, frozen_time
):
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser).where(AdminUser.username == "admin"))
        admin.locked_until = frozen_time + timedelta(minutes=10)
        db.commit()
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": admin_user["password"], "code": "000000"},
    )
    assert response.status_code == 429
    assert response.json()["detail"] == "locked"


def test_login_after_lock_expires(client, admin_user, panel_settings, frozen_time):
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser).where(AdminUser.username == "admin"))
        admin.locked_until = frozen_time - timedelta(seconds=1)
        admin.failed_attempts = 0
        db.commit()
    payload = login(client, admin_user, frozen_time)
    assert payload["username"] == "admin"
    assert payload["csrf_token"]


def test_totp_replay_rejected(client, admin_user, frozen_time):
    login(client, admin_user, frozen_time)
    response = client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": admin_user["password"],
            "code": totp_code(admin_user["totp_secret"], frozen_time),
        },
    )
    assert response.status_code == 401


def test_login_sets_cookie_flags(panel_settings, admin_user, frozen_time):
    panel_settings_secure = panel_settings.model_copy(update={"panel_cookie_secure": True})
    app = create_app(settings=panel_settings_secure)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": admin_user["password"],
                "code": totp_code(admin_user["totp_secret"], frozen_time),
            },
        )
        assert response.status_code == 200
        cookie = response.headers.get("set-cookie", "")
        assert "vpscp_session=" in cookie
        assert "HttpOnly" in cookie
        assert "SameSite=strict" in cookie or "SameSite=Strict" in cookie
        assert "Path=/" in cookie
        assert "Secure" in cookie


def test_login_cookie_not_secure_on_http_when_unset(panel_settings, admin_user, frozen_time):
    panel_settings_auto = panel_settings.model_copy(update={"panel_cookie_secure": None})
    app = create_app(settings=panel_settings_auto)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        response = client.post(
            "http://testserver/api/auth/login",
            json={
                "username": "admin",
                "password": admin_user["password"],
                "code": totp_code(admin_user["totp_secret"], frozen_time),
            },
        )
        assert response.status_code == 200
        cookie = response.headers.get("set-cookie", "")
        assert "vpscp_session=" in cookie
        assert "Secure" not in cookie


def test_login_cookie_secure_on_https_when_unset(panel_settings, admin_user, frozen_time):
    panel_settings_auto = panel_settings.model_copy(update={"panel_cookie_secure": None})
    app = create_app(settings=panel_settings_auto)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        response = client.post(
            "https://testserver/api/auth/login",
            json={
                "username": "admin",
                "password": admin_user["password"],
                "code": totp_code(admin_user["totp_secret"], frozen_time),
            },
        )
        assert response.status_code == 200
        cookie = response.headers.get("set-cookie", "")
        assert "vpscp_session=" in cookie
        assert "Secure" in cookie


def test_panel_cookie_secure_parsing():
    assert PanelSettings(PANEL_SECRET_KEY="k").panel_cookie_secure is None
    assert PanelSettings(PANEL_SECRET_KEY="k", PANEL_COOKIE_SECURE="").panel_cookie_secure is None
    assert PanelSettings(PANEL_SECRET_KEY="k", PANEL_COOKIE_SECURE="0").panel_cookie_secure is False
    assert PanelSettings(PANEL_SECRET_KEY="k", PANEL_COOKIE_SECURE="1").panel_cookie_secure is True


def test_bad_origin_rejected(client, admin_user, frozen_time):
    code = totp_code(admin_user["totp_secret"], frozen_time)
    response = client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": admin_user["password"],
            "code": code,
        },
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "bad_origin"}


def test_login_behind_tls_proxy_accepts_https_origin(
    panel_settings, admin_user, frozen_time
):
    panel_settings_auto = panel_settings.model_copy(update={"panel_cookie_secure": None})
    app = create_app(settings=panel_settings_auto)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        response = client.post(
            "http://panel.example.com/api/auth/login",
            json={
                "username": "admin",
                "password": admin_user["password"],
                "code": totp_code(admin_user["totp_secret"], frozen_time),
            },
            headers={
                "Origin": "https://panel.example.com",
                "Referer": "https://panel.example.com/login",
                "X-Forwarded-Proto": "https",
            },
        )
        assert response.status_code == 200, response.text
        assert "Secure" in response.headers.get("set-cookie", "")


def test_csrf_missing_on_logout(client, admin_user, frozen_time):
    login(client, admin_user, frozen_time)
    response = client.post("/api/auth/logout")
    assert response.status_code == 403
    assert response.json() == {"detail": "csrf_failed"}


def test_csrf_mismatch_on_logout(client, admin_user, frozen_time):
    login(client, admin_user, frozen_time)
    response = client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": "wrong-token"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "csrf_failed"}


def test_logout_clears_session(client, admin_user, frozen_time):
    payload = login(client, admin_user, frozen_time)
    response = client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": payload["csrf_token"]},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_me_updates_last_seen_and_reports_setup(client, admin_user, frozen_time, panel_settings):
    payload = login(client, admin_user, frozen_time)
    with db_module.SessionLocal() as db:
        set_setting(db, "setup", {"completed": True})
        db.commit()
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "admin"
    assert body["csrf_token"] == payload["csrf_token"]
    assert body["stepped_up_until"] is None
    assert body["setup_complete"] is True


def test_idle_session_expiry(client, admin_user, panel_settings, frozen_time):
    app = create_app(settings=panel_settings)
    t0 = frozen_time
    t1 = t0 + timedelta(hours=2, seconds=1)

    def clock():
        return app.state._test_now

    app.state.clock = clock
    app.state._test_now = t0
    with TestClient(app) as test_client:
        payload = login(test_client, admin_user, t0)
        app.state._test_now = t1
        response = test_client.get(
            "/api/auth/me",
            headers={"X-CSRF-Token": payload["csrf_token"]},
        )
        assert response.status_code == 401


def test_absolute_session_expiry(client, admin_user, panel_settings, frozen_time):
    app = create_app(settings=panel_settings)
    t0 = frozen_time
    t1 = t0 + timedelta(hours=12, seconds=1)

    def clock():
        return app.state._test_now

    app.state.clock = clock
    app.state._test_now = t0
    with TestClient(app) as test_client:
        login(test_client, admin_user, t0)
        app.state._test_now = t1
        assert test_client.get("/api/auth/me").status_code == 401


def test_step_up_wrong_code_does_not_lock_login(client, admin_user, frozen_time):
    payload = login(client, admin_user, frozen_time)
    for _ in range(5):
        response = client.post(
            "/api/auth/step-up",
            json={"code": "000000"},
            headers={"X-CSRF-Token": payload["csrf_token"]},
        )
        assert response.status_code == 401
        assert response.json() == {"detail": "invalid_credentials"}
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser).where(AdminUser.username == "admin"))
        assert admin.failed_attempts == 0
        assert admin.locked_until is None


def test_step_up_window_on_me(client, admin_user, panel_settings, frozen_time):
    app = create_app(settings=panel_settings)
    t0 = frozen_time

    def clock():
        return app.state._test_now

    app.state.clock = clock
    app.state._test_now = t0
    with TestClient(app) as test_client:
        payload = login(test_client, admin_user, t0)
        step_time = t0 + timedelta(seconds=31)
        app.state._test_now = step_time
        code = totp_code(admin_user["totp_secret"], step_time)
        step = test_client.post(
            "/api/auth/step-up",
            json={"code": code},
            headers={"X-CSRF-Token": payload["csrf_token"]},
        )
        assert step.status_code == 200
        until = step.json()["stepped_up_until"]
        me = test_client.get("/api/auth/me")
        assert me.json()["stepped_up_until"] == until
        app.state._test_now = step_time + timedelta(minutes=5, seconds=1)
        me_later = test_client.get("/api/auth/me")
        assert me_later.json()["stepped_up_until"] is None


@pytest.mark.asyncio
async def test_require_step_up_rejects_expired_window(frozen_time):
    from unittest.mock import MagicMock

    from vpscp_panel.models import Session

    session = Session(
        token_hash="abc",
        admin_id=1,
        csrf_token="csrf",
        created_at=frozen_time,
        last_seen_at=frozen_time,
        stepped_up_at=frozen_time - timedelta(minutes=6),
        user_agent="",
        ip="",
    )
    request = MagicMock()
    request.app.state.clock = lambda: frozen_time
    with pytest.raises(HTTPException) as exc_info:
        await require_step_up(request, session)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "step_up_required"
