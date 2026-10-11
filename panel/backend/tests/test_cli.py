import os
import re
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import vpscp_panel.db as db_module
from tests.conftest import totp_code
from vpscp_panel.db import init_db
from vpscp_panel.main import create_app
from vpscp_panel.models import AdminUser
from vpscp_panel.security import decrypt_secret

BACKEND = Path(__file__).resolve().parents[1]


def _run_cli(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    return subprocess.run(
        [sys.executable, "-m", "vpscp_panel.cli", *args],
        check=False,
        cwd=BACKEND,
        env=merged,
        capture_output=True,
        text=True,
    )


@pytest.fixture
def cli_env(panel_settings, monkeypatch):
    monkeypatch.setenv("PANEL_SECRET_KEY", panel_settings.panel_secret_key)
    monkeypatch.setenv("PANEL_DATA_DIR", str(panel_settings.panel_data_dir))
    monkeypatch.setenv("PANEL_STATIC_DIR", str(panel_settings.panel_static_dir))
    return panel_settings


def test_create_admin(cli_env):
    result = _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    assert result.returncode == 0, result.stderr
    assert "otpauth://totp/vpscp:admin?" in result.stdout
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser))
        assert admin is not None
        assert admin.username == "admin"
        secret = decrypt_secret(cli_env, admin.totp_secret_enc)
        assert pyotp.TOTP(secret).provisioning_uri(name="admin", issuer_name="vpscp")


def test_create_admin_duplicate_exits_2(cli_env):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    result = _run_cli(
        "create-admin",
        "--username",
        "other",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    assert result.returncode == 2


def test_create_admin_force_changes_username(cli_env):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    result = _run_cli(
        "create-admin",
        "--username",
        "other",
        "--force",
        env={"VPSCP_ADMIN_PASSWORD": "another-long-password"},
    )
    assert result.returncode == 0
    assert "otpauth://totp/vpscp:other?" in result.stdout
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser))
        assert admin.username == "other"


def test_create_admin_force_replaces(cli_env):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        old = decrypt_secret(cli_env, db.scalar(select(AdminUser)).totp_secret_enc)
    result = _run_cli(
        "create-admin",
        "--username",
        "admin",
        "--force",
        env={"VPSCP_ADMIN_PASSWORD": "another-long-password"},
    )
    assert result.returncode == 0
    with db_module.SessionLocal() as db:
        new = decrypt_secret(cli_env, db.scalar(select(AdminUser)).totp_secret_enc)
    assert old != new


def test_create_admin_short_password_rejected(cli_env):
    result = _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "short"},
    )
    assert result.returncode != 0
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        assert db.scalar(select(AdminUser)) is None


def test_reset_totp(cli_env):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        before = decrypt_secret(cli_env, db.scalar(select(AdminUser)).totp_secret_enc)
    result = _run_cli("reset-totp")
    assert result.returncode == 0
    assert "otpauth://" in result.stdout
    with db_module.SessionLocal() as db:
        after = decrypt_secret(cli_env, db.scalar(select(AdminUser)).totp_secret_enc)
    assert before != after


def test_has_admin_exits_1_when_no_admin(cli_env):
    result = _run_cli("has-admin")
    assert result.returncode == 1
    assert result.stdout == ""
    assert "otpauth://" not in result.stdout + result.stderr


def test_has_admin_exits_0_when_admin_exists(cli_env):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    result = _run_cli("has-admin")
    assert result.returncode == 0
    assert result.stdout == ""
    assert "otpauth://" not in result.stdout + result.stderr


def _lock_admin(cli_env, frozen_time, *, failed_attempts: int = 5):
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser))
        admin.failed_attempts = failed_attempts
        admin.locked_until = frozen_time + timedelta(minutes=10)
        db.commit()


def _login_via_api(cli_env, frozen_time, *, username: str, password: str, totp_secret: str):
    app = create_app(settings=cli_env)
    app.state.clock = lambda: frozen_time
    code = totp_code(totp_secret, frozen_time)
    with TestClient(app) as client:
        return client.post(
            "/api/auth/login",
            json={"username": username, "password": password, "code": code},
        )


def test_reset_password_clears_lockout_and_allows_login(cli_env, frozen_time):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    _lock_admin(cli_env, frozen_time)
    new_password = "brand-new-password12"
    result = _run_cli("reset-password", env={"VPSCP_ADMIN_PASSWORD": new_password})
    assert result.returncode == 0, result.stderr
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser))
        assert admin.failed_attempts == 0
        assert admin.locked_until is None
        secret = decrypt_secret(cli_env, admin.totp_secret_enc)
    response = _login_via_api(
        cli_env,
        frozen_time,
        username="admin",
        password=new_password,
        totp_secret=secret,
    )
    assert response.status_code == 200, response.text
    assert response.json()["username"] == "admin"


def test_reset_totp_clears_lockout_and_allows_login(cli_env, frozen_time):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    password = "long-enough-password"
    _lock_admin(cli_env, frozen_time)
    result = _run_cli("reset-totp")
    assert result.returncode == 0, result.stderr
    match = re.search(r"secret=([A-Z2-7]+)", result.stdout)
    assert match is not None
    new_secret = match.group(1)
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser))
        assert admin.failed_attempts == 0
        assert admin.locked_until is None
    response = _login_via_api(
        cli_env,
        frozen_time,
        username="admin",
        password=password,
        totp_secret=new_secret,
    )
    assert response.status_code == 200, response.text
    assert response.json()["username"] == "admin"


def test_reset_password(cli_env):
    _run_cli(
        "create-admin",
        "--username",
        "admin",
        env={"VPSCP_ADMIN_PASSWORD": "long-enough-password"},
    )
    result = _run_cli("reset-password", env={"VPSCP_ADMIN_PASSWORD": "brand-new-password12"})
    assert result.returncode == 0
    init_db(cli_env)
    with db_module.SessionLocal() as db:
        admin = db.scalar(select(AdminUser))
        from vpscp_panel.security import verify_password

        assert verify_password(admin.password_hash, "brand-new-password12")
