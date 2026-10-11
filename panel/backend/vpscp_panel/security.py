import hashlib
import secrets
from base64 import urlsafe_b64encode
from datetime import UTC, datetime

import pyotp
import pyotp.utils as pyotp_utils
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet

from vpscp_panel.config import PanelSettings
from vpscp_panel.models import AdminUser

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("vpscp-timing-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def dummy_password_hash() -> str:
    return _DUMMY_HASH


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _fernet(settings: PanelSettings) -> Fernet:
    key = urlsafe_b64encode(hashlib.sha256(settings.panel_secret_key.encode()).digest())
    return Fernet(key)


def encrypt_secret(settings: PanelSettings, plaintext: str) -> str:
    return _fernet(settings).encrypt(plaintext.encode()).decode()


def decrypt_secret(settings: PanelSettings, ciphertext: str) -> str:
    return _fernet(settings).decrypt(ciphertext.encode()).decode()


def _as_utc(when: datetime) -> datetime:
    if when.tzinfo is None:
        return when.replace(tzinfo=UTC)
    return when.astimezone(UTC)


def verify_totp(
    admin: AdminUser,
    code: str,
    now: datetime,
    *,
    settings: PanelSettings,
) -> bool:
    secret = decrypt_secret(settings, admin.totp_secret_enc)
    totp = pyotp.TOTP(secret)
    when = _as_utc(now)
    if not totp.verify(code, for_time=when, valid_window=1):
        return False
    matched_step: int | None = None
    base = totp.timecode(when)
    for offset in range(-1, 2):
        if pyotp_utils.strings_equal(str(code), str(totp.at(when, offset))):
            matched_step = base + offset
            break
    if matched_step is None:
        return False
    if admin.totp_last_step is not None and matched_step <= admin.totp_last_step:
        return False
    admin.totp_last_step = matched_step
    return True
