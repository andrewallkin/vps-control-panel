from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import tls
from vpscp_agent.config import load_settings
from vpscp_agent.credentials import write_cloudflare_ini
from vpscp_agent.domains import register_domain
from vpscp_agent.jobs import Job, JobContext, JobManager
from vpscp_agent.main import create_app
from vpscp_agent.state import StateDB


def _settings(tmp_path: Path):
    return load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
            "VPSCP_LETSENCRYPT_DIR": str(tmp_path / "letsencrypt"),
        }
    )


def _write_self_signed_fullchain(path: Path, *, domain: str, days: int = 90) -> datetime:
    path.parent.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, domain)])
    not_before = datetime.now(UTC)
    not_after = not_before + timedelta(days=days)
    san = x509.SubjectAlternativeName(
        [
            x509.DNSName(domain),
            x509.DNSName(f"*.{domain}"),
        ]
    )
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_after)
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return not_after


def _expected_certbot_issue_argv(domain: str, email: str, ini_path: Path) -> list[str]:
    return [
        "certbot",
        "certonly",
        "--non-interactive",
        "--agree-tos",
        "-m",
        email,
        "--dns-cloudflare",
        "--dns-cloudflare-credentials",
        str(ini_path),
        "--dns-cloudflare-propagation-seconds",
        "30",
        "--cert-name",
        domain,
        "-d",
        domain,
        "-d",
        f"*.{domain}",
        "--key-type",
        "ecdsa",
    ]


def _ctx(db: StateDB) -> JobContext:
    job = Job(kind="test", params={})
    JobManager(db)._jobs[job.id] = job
    return JobContext(job)


@pytest.fixture
def tls_env(tmp_path):
    settings = _settings(tmp_path)
    settings.state_dir.mkdir(parents=True)
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    return settings, runner, db


def test_load_settings_letsencrypt_dir_default():
    settings = load_settings({})
    assert settings.letsencrypt_dir == Path("/etc/letsencrypt")


def test_status_reads_self_signed_cert(tls_env):
    settings, _runner, db = tls_env
    register_domain(db, "example.com", "zone-1")
    fullchain = tls.cert_paths(settings, "example.com")["fullchain"]
    not_after = _write_self_signed_fullchain(fullchain, domain="example.com", days=60)

    rows = tls.status(settings, db)
    assert len(rows) == 1
    row = rows[0]
    assert row["domain"] == "example.com"
    assert row["exists"] is True
    assert row["sans"] == ["*.example.com", "example.com"]
    assert row["not_after"] is not None
    parsed = datetime.fromisoformat(row["not_after"])
    assert abs((parsed - not_after).total_seconds()) < 2
    assert row["days_left"] == (not_after.date() - datetime.now(UTC).date()).days


def test_status_missing_cert(tls_env):
    settings, _runner, db = tls_env
    register_domain(db, "example.com", "zone-1")

    rows = tls.status(settings, db)
    assert rows == [
        {
            "domain": "example.com",
            "exists": False,
            "not_after": None,
            "days_left": None,
            "sans": [],
        }
    ]


def test_issue_installs_hook_and_runs_certbot(tls_env):
    settings, runner, db = tls_env
    register_domain(db, "example.com", "zone-1")
    write_cloudflare_ini(settings, "cf-token-secret")
    ini_path = settings.state_dir / "cloudflare.ini"
    runner.on("certbot", stdout="line1\nline2\n", stderr="warn1\n")

    ctx = _ctx(db)
    tls.issue(
        ctx, settings=settings, runner=runner, domain="example.com", email="admin@example.com"
    )

    hook = settings.letsencrypt_dir / "renewal-hooks/deploy/vpscp-reload-nginx.sh"
    assert hook.read_text() == "#!/bin/sh\nsystemctl reload nginx\n"
    assert hook.stat().st_mode & 0o777 == 0o755
    assert len(runner.calls) == 1
    assert runner.calls[0]["args"] == _expected_certbot_issue_argv(
        "example.com", "admin@example.com", ini_path
    )
    assert ctx._job.lines == ["line1", "line2", "warn1"]


def test_renew_all_runs_certbot(tls_env):
    settings, runner, db = tls_env
    runner.on("certbot renew", stdout="ok\n")

    ctx = _ctx(db)
    tls.renew_all(ctx, settings=settings, runner=runner)

    assert runner.calls[0]["args"] == ["certbot", "renew", "--no-random-sleep-on-renew"]
    assert ctx._job.lines == ["ok"]


def test_issue_rejects_unregistered_domain(tls_env):
    settings, _runner, db = tls_env
    write_cloudflare_ini(settings, "token")
    with pytest.raises(ValueError, match="domain not registered"):
        tls.require_issue_preconditions(settings, db, "example.com", "a@b.com")


@pytest.fixture
def tls_client(tmp_path):
    settings = _settings(tmp_path)
    settings.state_dir.mkdir(parents=True)
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    app = create_app(settings, runner=runner)
    with TestClient(app) as client:
        yield client, settings, runner, db


def _set_acme_email(db: StateDB, email: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?)",
            ("acme_email", email),
        )


def test_issue_route_returns_job_and_validates(tls_client):
    client, settings, runner, db = tls_client
    register_domain(db, "example.com", "zone-1")
    write_cloudflare_ini(settings, "token")
    _set_acme_email(db, "admin@example.com")
    runner.on("certbot", stdout="done\n")

    resp = client.post("/v1/tls/issue", json={"domain": "example.com"})
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    job = client.app.state.jobs.wait(job_id, timeout=5)
    assert job.status == "succeeded"
    ini_path = settings.state_dir / "cloudflare.ini"
    assert runner.calls[0]["args"] == _expected_certbot_issue_argv(
        "example.com", "admin@example.com", ini_path
    )


def test_issue_route_400_missing_email(tls_client):
    client, settings, _runner, db = tls_client
    register_domain(db, "example.com", "zone-1")
    write_cloudflare_ini(settings, "token")

    resp = client.post("/v1/tls/issue", json={"domain": "example.com"})
    assert resp.status_code == 400
    assert "acme_email" in resp.json()["detail"]


def test_issue_route_400_missing_ini(tls_client):
    client, _settings, _runner, db = tls_client
    register_domain(db, "example.com", "zone-1")
    _set_acme_email(db, "admin@example.com")

    resp = client.post("/v1/tls/issue", json={"domain": "example.com"})
    assert resp.status_code == 400
    assert "Cloudflare" in resp.json()["detail"]


def test_issue_route_400_unregistered_domain(tls_client):
    client, settings, _runner, db = tls_client
    write_cloudflare_ini(settings, "token")
    _set_acme_email(db, "admin@example.com")

    resp = client.post("/v1/tls/issue", json={"domain": "example.com"})
    assert resp.status_code == 400
    assert "not registered" in resp.json()["detail"]


def test_get_tls_status_route(tls_client):
    client, settings, _runner, db = tls_client
    register_domain(db, "example.com", "zone-1")
    fullchain = tls.cert_paths(settings, "example.com")["fullchain"]
    _write_self_signed_fullchain(fullchain, domain="example.com")

    resp = client.get("/v1/tls/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["domain"] == "example.com"
    assert body[0]["exists"] is True


def test_renew_route_returns_job(tls_client):
    client, _settings, runner, _db = tls_client
    runner.on("certbot renew", stdout="renewed\n")

    resp = client.post("/v1/tls/renew")
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    job = client.app.state.jobs.wait(job_id, timeout=5)
    assert job.status == "succeeded"
    assert runner.calls[0]["args"] == ["certbot", "renew", "--no-random-sleep-on-renew"]
