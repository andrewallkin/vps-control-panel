from datetime import UTC, datetime

import pyotp
import pytest
from fastapi.testclient import TestClient

import vpscp_panel.db as db_module
from vpscp_panel.config import PanelSettings
from vpscp_panel.db import init_db, run_migrations
from vpscp_panel.main import create_app
from vpscp_panel.models import AdminUser
from vpscp_panel.security import encrypt_secret, hash_password


@pytest.fixture
def panel_settings(tmp_path) -> PanelSettings:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!DOCTYPE html><html><body>panel</body></html>")
    (static_dir / "app.js").write_text("// panel-app")
    return PanelSettings(
        PANEL_SECRET_KEY="test-secret-key-for-panel-tests",
        PANEL_DATA_DIR=str(data_dir),
        PANEL_STATIC_DIR=str(static_dir),
        PANEL_COOKIE_SECURE=False,
    )


@pytest.fixture
def frozen_time():
    return datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def client(panel_settings, frozen_time):
    app = create_app(settings=panel_settings)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin_user(panel_settings, frozen_time):
    run_migrations(panel_settings)
    init_db(panel_settings)
    assert db_module.SessionLocal is not None
    secret = pyotp.random_base32()
    with db_module.SessionLocal() as db:
        user = AdminUser(
            username="admin",
            password_hash=hash_password("valid-password-12"),
            totp_secret_enc=encrypt_secret(panel_settings, secret),
            totp_last_step=None,
            failed_attempts=0,
            locked_until=None,
            created_at=frozen_time,
        )
        db.add(user)
        db.commit()
    return {"username": "admin", "password": "valid-password-12", "totp_secret": secret}


def totp_code(secret: str, when: datetime | None = None) -> str:
    if when is None:
        return pyotp.TOTP(secret).now()
    return pyotp.TOTP(secret).at(when)


def login(client: TestClient, admin_user: dict, when: datetime | None = None) -> dict:
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
