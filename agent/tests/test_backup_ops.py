import base64
import json

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.backup_ops import (
    BackupSettingsIn,
    normalize_service_account,
    read_settings,
    run_now,
    status,
    write_settings,
)
from vpscp_agent.backup_ops import test_credentials as backup_test_credentials
from vpscp_agent.commands import CommandError
from vpscp_agent.main import create_app

SA_DOC = {
    "type": "service_account",
    "client_email": "test@example.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n",
}


def sa_json() -> str:
    return json.dumps(SA_DOC)


def sa_b64() -> str:
    encoded, _ = normalize_service_account(sa_json())
    return encoded


def default_body(**overrides) -> dict:
    base = {
        "service_account": sa_json(),
        "bucket": "my-backup-bucket",
        "schedule_hours": "0,12",
        "schedule_minute": 0,
        "timezone": "UTC",
        "retention_days": 30,
        "archive_passphrase": "long-passphrase",
    }
    base.update(overrides)
    return base


@pytest.fixture
def stack_settings(settings, tmp_path):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text(
        "# keep me\nPOSTGRES_USER=pgadmin\nOTHER=value\n",
        encoding="utf-8",
    )
    return settings


@pytest.fixture
def backup_client(stack_settings):
    runner = FakeRunner()
    with TestClient(create_app(stack_settings, runner=runner)) as client:
        yield client, runner, stack_settings


def test_normalize_service_account_json_and_base64():
    b64_a, email_a = normalize_service_account(sa_json())
    b64_b, email_b = normalize_service_account(sa_b64())
    assert email_a == SA_DOC["client_email"]
    assert email_b == SA_DOC["client_email"]
    assert b64_a == b64_b
    assert "\n" not in b64_a


def test_normalize_service_account_wrong_type_rejected():
    bad = json.dumps({**SA_DOC, "type": "authorized_user"})
    with pytest.raises(ValueError, match="service_account"):
        normalize_service_account(bad)


def test_normalize_service_account_non_object_rejected():
    array_b64 = base64.b64encode(b"[1,2,3]").decode()
    with pytest.raises(ValueError, match="invalid service account JSON"):
        normalize_service_account(array_b64)


def test_backup_settings_in_normalizes_schedule_hours():
    body = BackupSettingsIn(**default_body(schedule_hours="12,0,12"))
    assert body.schedule_hours == "0,12"


def test_backup_settings_in_rejects_invalid_hour():
    with pytest.raises(ValueError):
        BackupSettingsIn(**default_body(schedule_hours="24"))


def test_write_settings_env_keys_and_preserves_comments(stack_settings):
    runner = FakeRunner()
    runner.on("docker compose")
    body = BackupSettingsIn(**default_body())
    out = write_settings(stack_settings, runner, body)
    text = stack_settings.stack_env_path.read_text()
    assert "# keep me\n" in text
    assert "OTHER=value\n" in text
    assert "POSTGRES_USER=pgadmin\n" in text
    assert f"GCP_SERVICE_ACCOUNT_CREDENTIALS={sa_b64()}\n" in text
    assert "GCS_DB_BACKUP_BUCKET_NAME=my-backup-bucket\n" in text
    assert "BACKUP_SCHEDULE_HOUR=0,12\n" in text
    assert "BACKUP_ARCHIVE_PASSPHRASE=long-passphrase\n" in text
    assert out.credentials_configured is True
    assert out.client_email == SA_DOC["client_email"]


def test_write_settings_rolls_back_env_on_compose_failure(stack_settings):
    runner = FakeRunner()
    runner.on("docker compose", returncode=1, stderr="compose failed")
    original = stack_settings.stack_env_path.read_text()
    with pytest.raises(CommandError):
        write_settings(stack_settings, runner, BackupSettingsIn(**default_body()))
    assert stack_settings.stack_env_path.read_text() == original


def test_write_settings_compose_recreate_cwd(stack_settings):
    runner = FakeRunner()
    runner.on("docker compose")
    write_settings(stack_settings, runner, BackupSettingsIn(**default_body()))
    compose = next(c for c in runner.calls if c["args"][:3] == ["docker", "compose", "up"])
    assert compose["args"] == [
        "docker",
        "compose",
        "up",
        "-d",
        "--no-deps",
        "--force-recreate",
        "backup",
    ]
    assert compose["cwd"] == stack_settings.stack_dir


def test_write_settings_passphrase_keep_and_clear(stack_settings):
    runner = FakeRunner()
    runner.on("docker compose")
    stack_settings.stack_env_path.write_text(
        "BACKUP_ARCHIVE_PASSPHRASE=existing\n",
        encoding="utf-8",
    )
    keep = BackupSettingsIn(**default_body(archive_passphrase=None))
    write_settings(stack_settings, runner, keep)
    assert "BACKUP_ARCHIVE_PASSPHRASE=existing\n" in stack_settings.stack_env_path.read_text()

    clear = BackupSettingsIn(**default_body(archive_passphrase=""))
    write_settings(stack_settings, runner, clear)
    assert "BACKUP_ARCHIVE_PASSPHRASE=\n" in stack_settings.stack_env_path.read_text()


def test_write_settings_credentials_not_in_argv(stack_settings):
    runner = FakeRunner()
    runner.on("docker compose")
    cred = sa_b64()
    write_settings(stack_settings, runner, BackupSettingsIn(**default_body()))
    for call in runner.calls:
        joined = " ".join(call["args"])
        assert cred not in joined
        assert SA_DOC["private_key"] not in joined


def test_test_credentials_uses_extra_env_only(stack_settings):
    runner = FakeRunner()
    runner.on("docker run", stdout="ok\n", returncode=0)
    result = backup_test_credentials(stack_settings, runner, sa_json(), "my-backup-bucket")
    assert result == {"ok": True, "message": "ok"}
    call = runner.calls[0]
    assert call["args"] == [
        "docker",
        "run",
        "--rm",
        "-e",
        "GCP_SERVICE_ACCOUNT_CREDENTIALS",
        "-e",
        "GCS_DB_BACKUP_BUCKET_NAME",
        stack_settings.backup_image,
        "uv",
        "run",
        "--no-sync",
        "python",
        "check_gcs.py",
    ]
    assert call["extra_env"]["GCP_SERVICE_ACCOUNT_CREDENTIALS"] == sa_b64()
    assert call["extra_env"]["GCS_DB_BACKUP_BUCKET_NAME"] == "my-backup-bucket"
    assert sa_b64() not in " ".join(call["args"])


def test_run_now_creates_state_dir(stack_settings):
    run_now(stack_settings)
    assert stack_settings.backup_state_dir.is_dir()
    assert oct(stack_settings.backup_state_dir.stat().st_mode & 0o777) == "0o700"
    assert (stack_settings.backup_state_dir / "run-now").is_file()


def test_status_reads_last_run_and_container(stack_settings):
    runner = FakeRunner()
    stack_settings.backup_state_dir.mkdir(parents=True, mode=0o700)
    (stack_settings.backup_state_dir / "last_run.json").write_text('{"ok": true}', encoding="utf-8")
    (stack_settings.backup_state_dir / "run-now").touch()
    runner.on(
        "vpscp-backup",
        stdout="running\n",
    )
    data = status(stack_settings, runner)
    assert data["last_run"] == {"ok": True}
    assert data["trigger_pending"] is True
    assert data["container"] == "running"
    docker_call = next(c for c in runner.calls if c["args"][0] == "docker")
    assert docker_call["args"] == [
        "docker",
        "ps",
        "-a",
        "--filter",
        "name=vpscp-backup",
        "--format",
        "{{.State}}",
    ]


def test_get_settings_not_audited(backup_client):
    client, _runner, settings = backup_client
    b64 = sa_b64()
    settings.stack_env_path.write_text(
        f"GCP_SERVICE_ACCOUNT_CREDENTIALS={b64}\n"
        "GCS_DB_BACKUP_BUCKET_NAME=b\n"
        "BACKUP_SCHEDULE_HOUR=0\n"
        "BACKUP_SCHEDULE_MINUTE=5\n"
        "BACKUP_TIMEZONE=UTC\n"
        "BACKUP_RETENTION_DAYS=7\n",
        encoding="utf-8",
    )
    db = client.app.state.db
    before = len(audit.list_events(db))
    response = client.get("/v1/backup/settings")
    assert response.status_code == 200
    assert len(audit.list_events(db)) == before


def test_put_settings_audited_and_secrets_masked(backup_client):
    client, runner, _settings = backup_client
    runner.on("docker compose")
    response = client.put("/v1/backup/settings", json=default_body())
    assert response.status_code == 200
    events = audit.list_events(client.app.state.db)
    assert events[0].operation == "backup.write_settings"
    params = events[0].params
    assert params["service_account"] == "***"
    assert params["archive_passphrase"] == "***"
    assert sa_b64() not in json.dumps(params)


def test_put_settings_value_error_returns_400(backup_client):
    client, _runner, _settings = backup_client
    bad = default_body()
    bad["service_account"] = json.dumps({**SA_DOC, "type": "wrong"})
    response = client.put("/v1/backup/settings", json=bad)
    assert response.status_code == 400


def test_read_settings_from_env(stack_settings):
    b64 = sa_b64()
    stack_settings.stack_env_path.write_text(
        f"GCP_SERVICE_ACCOUNT_CREDENTIALS={b64}\n"
        "GCS_DB_BACKUP_BUCKET_NAME=my-backup-bucket\n"
        "BACKUP_SCHEDULE_HOUR=0,12\n"
        "BACKUP_SCHEDULE_MINUTE=15\n"
        "BACKUP_TIMEZONE=Africa/Johannesburg\n"
        "BACKUP_RETENTION_DAYS=90\n"
        "BACKUP_ARCHIVE_PASSPHRASE=secret\n",
        encoding="utf-8",
    )
    out = read_settings(stack_settings)
    assert out.bucket == "my-backup-bucket"
    assert out.schedule_hours == "0,12"
    assert out.credentials_configured is True
    assert out.client_email == SA_DOC["client_email"]
    assert out.archive_passphrase_set is True
