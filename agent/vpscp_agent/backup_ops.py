from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from vpscp_agent.commands import CommandError, CommandResult
from vpscp_agent.config import Settings
from vpscp_agent.envfile import read_env, write_env_atomic

BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$")
SCHEDULE_HOURS_RE = re.compile(r"^\d{1,2}(,\d{1,2})*$")

ENV_GCP_CREDENTIALS = "GCP_SERVICE_ACCOUNT_CREDENTIALS"
ENV_BUCKET = "GCS_DB_BACKUP_BUCKET_NAME"
ENV_SCHEDULE_HOUR = "BACKUP_SCHEDULE_HOUR"
ENV_SCHEDULE_MINUTE = "BACKUP_SCHEDULE_MINUTE"
ENV_TIMEZONE = "BACKUP_TIMEZONE"
ENV_RETENTION = "BACKUP_RETENTION_DAYS"
ENV_ARCHIVE_PASSPHRASE = "BACKUP_ARCHIVE_PASSPHRASE"


def _parse_service_account_json(data: dict) -> tuple[str, str]:
    if data.get("type") != "service_account":
        raise ValueError('service account JSON must have type "service_account"')
    client_email = data.get("client_email")
    private_key = data.get("private_key")
    if not client_email or not private_key:
        raise ValueError("service account JSON missing client_email or private_key")
    canonical = json.dumps(data, separators=(",", ":"), sort_keys=True)
    encoded = base64.b64encode(canonical.encode()).decode()
    return encoded, str(client_email)


def normalize_service_account(text: str) -> tuple[str, str]:
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError("invalid service account JSON") from exc
        if not isinstance(data, dict):
            raise ValueError("invalid service account JSON")
        return _parse_service_account_json(data)
    try:
        raw = base64.b64decode(stripped, validate=True)
    except Exception as exc:
        raise ValueError("invalid service account credentials") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("invalid service account JSON in base64") from exc
    if not isinstance(data, dict):
        raise ValueError("invalid service account JSON in base64")  # noqa: TRY004
    return _parse_service_account_json(data)


def normalize_schedule_hours(value: str) -> str:
    if not SCHEDULE_HOURS_RE.fullmatch(value):
        raise ValueError(f"invalid schedule_hours: {value!r}")
    parts = [int(part) for part in value.split(",")]
    for hour in parts:
        if hour < 0 or hour > 23:
            raise ValueError(f"invalid schedule hour: {hour}")
    return ",".join(str(h) for h in sorted(set(parts)))


def _client_email_from_stored(credentials_b64: str | None) -> str | None:
    if not credentials_b64:
        return None
    try:
        raw = base64.b64decode(credentials_b64, validate=True)
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError, TypeError):
        return None
    if isinstance(data, dict):
        email = data.get("client_email")
        return str(email) if email else None
    return None


class BackupSettingsIn(BaseModel):
    service_account: str | None = None
    bucket: str
    schedule_hours: str
    schedule_minute: int = Field(ge=0, le=59)
    timezone: str
    retention_days: int = Field(ge=1, le=3650)
    archive_passphrase: str | None = None

    @field_validator("bucket")
    @classmethod
    def validate_bucket(cls, value: str) -> str:
        if not BUCKET_RE.fullmatch(value):
            raise ValueError(f"invalid bucket name: {value!r}")
        return value

    @field_validator("schedule_hours")
    @classmethod
    def validate_schedule_hours(cls, value: str) -> str:
        return normalize_schedule_hours(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"invalid timezone: {value!r}") from exc
        return value

    @field_validator("archive_passphrase")
    @classmethod
    def validate_archive_passphrase(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return value
        if len(value) < 12:
            raise ValueError("archive_passphrase must be at least 12 characters")
        return value


class BackupSettingsOut(BaseModel):
    bucket: str
    schedule_hours: str
    schedule_minute: int
    timezone: str
    retention_days: int
    credentials_configured: bool
    client_email: str | None
    archive_passphrase_set: bool


def _settings_from_env(env) -> BackupSettingsOut:
    creds = env.get(ENV_GCP_CREDENTIALS)
    bucket = env.get(ENV_BUCKET) or ""
    schedule_hours_raw = env.get(ENV_SCHEDULE_HOUR) or "0"
    try:
        schedule_hours = normalize_schedule_hours(schedule_hours_raw)
    except ValueError:
        schedule_hours = schedule_hours_raw
    minute_raw = env.get(ENV_SCHEDULE_MINUTE) or "0"
    timezone = env.get(ENV_TIMEZONE) or "UTC"
    retention_raw = env.get(ENV_RETENTION) or "30"
    return BackupSettingsOut(
        bucket=bucket,
        schedule_hours=schedule_hours,
        schedule_minute=int(minute_raw),
        timezone=timezone,
        retention_days=int(retention_raw),
        credentials_configured=bool(creds),
        client_email=_client_email_from_stored(creds),
        archive_passphrase_set=bool(env.get(ENV_ARCHIVE_PASSPHRASE)),
    )


def read_settings(settings: Settings) -> BackupSettingsOut:
    env = read_env(settings.stack_env_path)
    return _settings_from_env(env)


def _restore_env_bytes(path: Path, previous: bytes) -> None:
    if not previous:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(previous)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    os.replace(tmp_path, path)
    os.chmod(path, 0o600)


def write_settings(settings: Settings, runner, body: BackupSettingsIn) -> BackupSettingsOut:
    env_path = settings.stack_env_path
    previous = env_path.read_bytes() if env_path.is_file() else b""
    env = read_env(env_path)
    updates: dict[str, str] = {
        ENV_BUCKET: body.bucket,
        ENV_SCHEDULE_HOUR: body.schedule_hours,
        ENV_SCHEDULE_MINUTE: str(body.schedule_minute),
        ENV_TIMEZONE: body.timezone,
        ENV_RETENTION: str(body.retention_days),
    }
    if body.service_account is not None:
        cred_b64, _ = normalize_service_account(body.service_account)
        updates[ENV_GCP_CREDENTIALS] = cred_b64
    if body.archive_passphrase is not None:
        updates[ENV_ARCHIVE_PASSPHRASE] = body.archive_passphrase
    env.set_many(updates)
    write_env_atomic(env_path, env)
    try:
        runner(
            [
                "docker",
                "compose",
                "up",
                "-d",
                "--no-deps",
                "--force-recreate",
                "backup",
            ],
            cwd=settings.stack_dir,
        )
    except CommandError:
        _restore_env_bytes(env_path, previous)
        raise
    return read_settings(settings)


def _last_line(result: CommandResult) -> str:
    combined = (result.stdout + result.stderr).splitlines()
    if not combined:
        return ""
    return combined[-1].strip()


def test_credentials(
    settings: Settings,
    runner,
    service_account: str | None,
    bucket: str,
) -> dict:
    env_file = read_env(settings.stack_env_path)
    if service_account is not None:
        cred_b64, _ = normalize_service_account(service_account)
    else:
        stored = env_file.get(ENV_GCP_CREDENTIALS)
        if not stored:
            raise ValueError("no stored service account credentials")
        cred_b64 = stored
    result = runner(
        [
            "docker",
            "run",
            "--rm",
            "-e",
            ENV_GCP_CREDENTIALS,
            "-e",
            ENV_BUCKET,
            settings.backup_image,
            "uv",
            "run",
            "--no-sync",
            "python",
            "check_gcs.py",
        ],
        extra_env={
            ENV_GCP_CREDENTIALS: cred_b64,
            ENV_BUCKET: bucket,
        },
        check=False,
        timeout=60,
    )
    return {"ok": result.returncode == 0, "message": _last_line(result)}


def run_now(settings: Settings) -> None:
    settings.backup_state_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(settings.backup_state_dir, 0o700)
    (settings.backup_state_dir / "run-now").touch()


def status(settings: Settings, runner) -> dict:
    last_run = None
    last_run_path = settings.backup_state_dir / "last_run.json"
    if last_run_path.is_file():
        try:
            last_run = json.loads(last_run_path.read_text())
        except json.JSONDecodeError:
            last_run = None
    trigger_pending = (settings.backup_state_dir / "run-now").is_file()
    container_result = runner(
        [
            "docker",
            "ps",
            "-a",
            "--filter",
            "name=vpscp-backup",
            "--format",
            "{{.State}}",
        ],
    )
    container = container_result.stdout.strip()
    return {
        "last_run": last_run,
        "trigger_pending": trigger_pending,
        "container": container,
    }
