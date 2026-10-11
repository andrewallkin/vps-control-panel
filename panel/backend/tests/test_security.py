from datetime import UTC, datetime

import pyotp
import pytest

from vpscp_panel.config import PanelSettings
from vpscp_panel.models import AdminUser
from vpscp_panel.security import (
    decrypt_secret,
    encrypt_secret,
    hash_password,
    new_token,
    token_hash,
    verify_password,
    verify_totp,
)


@pytest.fixture
def settings() -> PanelSettings:
    return PanelSettings(PANEL_SECRET_KEY="test-secret-key-for-panel-tests")


def test_new_token_length_and_uniqueness():
    a = new_token()
    b = new_token()
    assert len(a) >= 32
    assert a != b


def test_token_hash_is_sha256_hex():
    token = "abc"
    h = token_hash(token)
    assert len(h) == 64
    assert h == token_hash(token)


def test_hash_and_verify_password():
    hashed = hash_password("correct-horse-battery")
    assert verify_password(hashed, "correct-horse-battery")
    assert not verify_password(hashed, "wrong")


def test_encrypt_decrypt_roundtrip(settings):
    plain = "JBSWY3DPEHPK3PXP"
    enc = encrypt_secret(settings, plain)
    assert enc != plain
    assert decrypt_secret(settings, enc) == plain


def test_verify_totp_accepts_valid_code(settings):
    secret = pyotp.random_base32()
    admin = AdminUser(
        username="admin",
        password_hash="x",
        totp_secret_enc=encrypt_secret(settings, secret),
        totp_last_step=None,
        failed_attempts=0,
        locked_until=None,
        created_at=datetime.now(UTC),
    )
    now = datetime.now(UTC)
    code = pyotp.TOTP(secret).now()
    assert verify_totp(admin, code, now, settings=settings) is True
    assert admin.totp_last_step is not None


def test_verify_totp_rejects_replay(settings):
    secret = pyotp.random_base32()
    admin = AdminUser(
        username="admin",
        password_hash="x",
        totp_secret_enc=encrypt_secret(settings, secret),
        totp_last_step=None,
        failed_attempts=0,
        locked_until=None,
        created_at=datetime.now(UTC),
    )
    now = datetime.now(UTC)
    code = pyotp.TOTP(secret).now()
    assert verify_totp(admin, code, now, settings=settings) is True
    step = admin.totp_last_step
    assert step is not None
    assert verify_totp(admin, code, now, settings=settings) is False
    assert admin.totp_last_step == step
