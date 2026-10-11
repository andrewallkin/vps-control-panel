from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import vpscp_agent.nginx_apply as nginx_apply_mod
from tests.fakes import FakeRunner
from vpscp_agent.commands import CommandError
from vpscp_agent.config import load_settings
from vpscp_agent.domains import register_domain
from vpscp_agent.hostnames import claim_hostnames
from vpscp_agent.main import create_app
from vpscp_agent.nginx_apply import (
    NginxTestError,
    apply_site,
    ensure_base_config,
    remove_site,
    site_conf_path,
    site_enabled_path,
    verify_certificates,
)
from vpscp_agent.nginx_render import HostnameSpec, RouteSpec, SiteSpec, render_site
from vpscp_agent.state import StateDB


@pytest.fixture
def nginx_env(tmp_path, monkeypatch):
    nginx_dir = tmp_path / "nginx"
    le_root = tmp_path / "le"
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
            "VPSCP_NGINX_DIR": str(nginx_dir),
            "VPSCP_LETSENCRYPT_DIR": str(le_root),
        }
    )
    original_is_file = Path.is_file

    def patched_is_file(self: Path) -> bool:
        text = str(self)
        if text.startswith("/etc/letsencrypt/"):
            mapped = le_root / text.removeprefix("/etc/letsencrypt/").lstrip("/")
            return mapped.is_file()
        return original_is_file(self)

    monkeypatch.setattr(Path, "is_file", patched_is_file)

    db = StateDB(settings.state_db_path)
    db.migrate()
    register_domain(db, "example.com", "zone-1")
    runner = FakeRunner()
    runner.on("nginx -t", stdout="syntax ok\n")
    runner.on("systemctl reload nginx", stdout="")
    return settings, runner, db, le_root


def _touch_cert(le_root, domain: str) -> None:
    cert_dir = le_root / "live" / domain
    cert_dir.mkdir(parents=True)
    (cert_dir / "fullchain.pem").write_text("cert")
    (cert_dir / "privkey.pem").write_text("key")


def _site_spec(site_id: str = "budget") -> SiteSpec:
    return SiteSpec(
        site_id=site_id,
        hostnames=[
            HostnameSpec(fqdn="budget.example.com", domain="example.com", kind="primary"),
        ],
        routes=[RouteSpec(path="/", port=10000)],
    )


def test_verify_certificates_missing(nginx_env):
    _settings, _runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "other.com")
    content = "ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;\n"
    with pytest.raises(ValueError, match="certificate for example.com not issued"):
        verify_certificates(content)


def test_apply_site_writes_config_and_symlink(nginx_env):
    settings, runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    content = render_site(_site_spec())
    apply_site("budget", content, settings=settings, runner=runner)
    conf = site_conf_path(settings.nginx_dir, "budget")
    enabled = site_enabled_path(settings.nginx_dir, "budget")
    assert conf.read_text() == content
    assert enabled.is_symlink()
    assert enabled.resolve() == conf.resolve()
    assert any("nginx" in " ".join(c["args"]) and "-t" in c["args"] for c in runner.calls)
    assert runner.calls[-1]["args"] == ["systemctl", "reload", "nginx"]


def test_apply_site_nginx_test_failure_restores_previous_bytes(nginx_env):
    settings, runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    original = b"original nginx config\n"
    conf = site_conf_path(settings.nginx_dir, "budget")
    conf.parent.mkdir(parents=True)
    conf.write_bytes(original)
    enabled = site_enabled_path(settings.nginx_dir, "budget")
    enabled.parent.mkdir(parents=True)
    enabled.symlink_to(conf)

    runner.responses.clear()
    runner.on("nginx -t", stderr="syntax error\n", returncode=1)
    content = render_site(_site_spec())
    with pytest.raises(NginxTestError, match="syntax error"):
        apply_site("budget", content, settings=settings, runner=runner)
    assert conf.read_bytes() == original


def test_remove_site_deletes_and_releases(nginx_env):
    settings, runner, db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    content = render_site(_site_spec())
    apply_site("budget", content, settings=settings, runner=runner)
    claim_hostnames(db, "budget", ["budget.example.com"])
    conf = site_conf_path(settings.nginx_dir, "budget")
    enabled = site_enabled_path(settings.nginx_dir, "budget")
    remove_site("budget", settings=settings, runner=runner, db=db)
    assert not conf.exists()
    assert not enabled.exists()
    with db.connect() as conn:
        assert conn.execute("SELECT 1 FROM hostname WHERE site = ?", ("budget",)).fetchone() is None


def test_remove_site_nginx_failure_restores(nginx_env):
    settings, runner, db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    content = render_site(_site_spec())
    apply_site("budget", content, settings=settings, runner=runner)
    claim_hostnames(db, "budget", ["budget.example.com"])
    conf = site_conf_path(settings.nginx_dir, "budget")
    saved = conf.read_bytes()

    runner.responses.clear()
    runner.on("nginx -t", stderr="still broken\n", returncode=1)
    with pytest.raises(NginxTestError):
        remove_site("budget", settings=settings, runner=runner, db=db)
    assert conf.read_bytes() == saved
    assert site_enabled_path(settings.nginx_dir, "budget").exists()


def test_remove_site_reload_failure_restores_and_keeps_hostnames(nginx_env):
    settings, runner, db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    content = render_site(_site_spec())
    apply_site("budget", content, settings=settings, runner=runner)
    claim_hostnames(db, "budget", ["budget.example.com"])
    conf = site_conf_path(settings.nginx_dir, "budget")
    enabled = site_enabled_path(settings.nginx_dir, "budget")
    saved = conf.read_bytes()

    runner.responses.clear()
    runner.on("nginx -t", stdout="syntax ok\n")
    runner.on("systemctl reload nginx", returncode=1, stderr="reload failed\n")
    with pytest.raises(CommandError):
        remove_site("budget", settings=settings, runner=runner, db=db)
    assert conf.read_bytes() == saved
    assert enabled.is_symlink() and enabled.resolve() == conf.resolve()
    with db.connect() as conn:
        assert (
            conn.execute("SELECT 1 FROM hostname WHERE site = ?", ("budget",)).fetchone()
            is not None
        )


def test_ensure_base_config_reload_failure_restores_previous(nginx_env):
    settings, runner, db, _letsencrypt = nginx_env

    def fake_fetch():
        return ["203.0.113.0/24"], ["2001:db8::/32"]

    realip = settings.nginx_dir / "conf.d" / "vpscp-realip.conf"
    default_conf = settings.nginx_dir / "sites-available" / "vpscp-default.conf"
    default_link = settings.nginx_dir / "sites-enabled" / "vpscp-default.conf"
    stock_default = settings.nginx_dir / "sites-enabled" / "default"
    stock_target = settings.nginx_dir / "sites-available" / "default"

    realip.parent.mkdir(parents=True)
    realip.write_bytes(b"old realip\n")
    default_conf.parent.mkdir(parents=True)
    default_conf.write_bytes(b"old default server\n")
    default_link.parent.mkdir(parents=True)
    default_link.symlink_to(default_conf)
    stock_target.write_bytes(b"stock default\n")
    stock_default.parent.mkdir(parents=True, exist_ok=True)
    stock_default.symlink_to(stock_target)

    runner.responses.clear()
    runner.on("nginx -t", stdout="syntax ok\n")
    runner.on("systemctl reload nginx", returncode=1, stderr="reload failed\n")
    with pytest.raises(CommandError, match="reload failed"):
        ensure_base_config(settings=settings, runner=runner, db=db, fetch=fake_fetch)

    assert realip.read_bytes() == b"old realip\n"
    assert default_conf.read_bytes() == b"old default server\n"
    assert default_link.is_symlink() and default_link.resolve() == default_conf.resolve()
    assert stock_default.is_symlink() and stock_default.resolve() == stock_target.resolve()


def test_ensure_base_config_nginx_test_failure_restores_previous(nginx_env):
    settings, runner, db, _letsencrypt = nginx_env

    def fake_fetch():
        return ["203.0.113.0/24"], ["2001:db8::/32"]

    realip = settings.nginx_dir / "conf.d" / "vpscp-realip.conf"
    default_conf = settings.nginx_dir / "sites-available" / "vpscp-default.conf"
    default_link = settings.nginx_dir / "sites-enabled" / "vpscp-default.conf"
    stock_default = settings.nginx_dir / "sites-enabled" / "default"
    stock_target = settings.nginx_dir / "sites-available" / "default"

    realip.parent.mkdir(parents=True)
    realip.write_bytes(b"old realip\n")
    default_conf.parent.mkdir(parents=True)
    default_conf.write_bytes(b"old default server\n")
    default_link.parent.mkdir(parents=True)
    default_link.symlink_to(default_conf)
    stock_target.write_bytes(b"stock default\n")
    stock_default.parent.mkdir(parents=True, exist_ok=True)
    stock_default.symlink_to(stock_target)

    runner.responses.clear()
    runner.on("nginx -t", stderr="base broken\n", returncode=1)
    with pytest.raises(NginxTestError, match="base broken"):
        ensure_base_config(settings=settings, runner=runner, db=db, fetch=fake_fetch)

    assert realip.read_bytes() == b"old realip\n"
    assert default_conf.read_bytes() == b"old default server\n"
    assert default_link.is_symlink() and default_link.resolve() == default_conf.resolve()
    assert stock_default.is_symlink() and stock_default.resolve() == stock_target.resolve()


def test_apply_site_reload_failure_restores_previous(nginx_env):
    settings, runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    original = b"original nginx config\n"
    conf = site_conf_path(settings.nginx_dir, "budget")
    conf.parent.mkdir(parents=True)
    conf.write_bytes(original)
    enabled = site_enabled_path(settings.nginx_dir, "budget")
    enabled.parent.mkdir(parents=True)
    enabled.symlink_to(conf)

    runner.responses.clear()
    runner.on("nginx -t", stdout="syntax ok\n")
    runner.on("systemctl reload nginx", returncode=1, stderr="reload failed\n")
    content = render_site(_site_spec())
    with pytest.raises(CommandError):
        apply_site("budget", content, settings=settings, runner=runner)
    assert conf.read_bytes() == original
    assert enabled.is_symlink() and enabled.resolve() == conf.resolve()


def test_apply_site_post_install_failure_removes_new_config(nginx_env):
    settings, runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    conf = site_conf_path(settings.nginx_dir, "budget")
    enabled = site_enabled_path(settings.nginx_dir, "budget")
    assert not conf.exists()

    runner.responses.clear()
    runner.on("nginx -t", stderr="bad\n", returncode=1)
    content = render_site(_site_spec())
    with pytest.raises(NginxTestError):
        apply_site("budget", content, settings=settings, runner=runner)
    assert not conf.exists()
    assert not enabled.exists()


def test_apply_site_symlink_failure_restores_previous(nginx_env, monkeypatch):
    settings, runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    original = b"original nginx config\n"
    conf = site_conf_path(settings.nginx_dir, "budget")
    conf.parent.mkdir(parents=True)
    conf.write_bytes(original)

    def boom(*_args, **_kwargs):
        raise OSError("symlink failed")

    monkeypatch.setattr(nginx_apply_mod, "_ensure_symlink", boom)
    content = render_site(_site_spec())
    with pytest.raises(OSError, match="symlink failed"):
        apply_site("budget", content, settings=settings, runner=runner)
    assert conf.read_bytes() == original


def test_ensure_base_config_writes_realip_and_default(nginx_env):
    settings, runner, db, _letsencrypt = nginx_env

    def fake_fetch():
        return ["203.0.113.0/24"], ["2001:db8::/32"]

    ensure_base_config(settings=settings, runner=runner, db=db, fetch=fake_fetch)
    realip = settings.nginx_dir / "conf.d" / "vpscp-realip.conf"
    default_conf = settings.nginx_dir / "sites-available" / "vpscp-default.conf"
    default_link = settings.nginx_dir / "sites-enabled" / "vpscp-default.conf"
    assert "203.0.113.0/24" in realip.read_text()
    assert "listen 80 default_server;" in default_conf.read_text()
    assert default_link.is_symlink()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT value FROM agent_setting WHERE key = ?", ("cloudflare_ips_v4",)
        ).fetchone()
    assert row is not None
    assert "203.0.113.0/24" in row["value"]


def test_invalid_site_id_rejected(nginx_env):
    settings, runner, _db, letsencrypt = nginx_env
    _touch_cert(letsencrypt, "example.com")
    with pytest.raises(ValueError, match="invalid project slug"):
        apply_site("../evil", "server {}", settings=settings, runner=runner)


@pytest.fixture
def nginx_client(nginx_env):
    settings, runner, db, letsencrypt = nginx_env
    app = create_app(settings, runner=runner)
    with TestClient(app) as client:
        yield client, runner, db, letsencrypt


def test_post_nginx_site_applies_and_audited(nginx_client):
    client, _runner, db, letsencrypt = nginx_client
    _touch_cert(letsencrypt, "example.com")
    spec = _site_spec().model_dump()
    response = client.post("/v1/nginx/sites", json={"spec": spec})
    assert response.status_code == 200
    assert response.json()["site_id"] == "budget"
    audit = client.get("/v1/audit?limit=5").json()
    assert audit[0]["operation"] == "nginx.site.apply"
    assert audit[0]["ok"] is True
    with db.connect() as conn:
        row = conn.execute("SELECT fqdn FROM hostname WHERE site = ?", ("budget",)).fetchone()
    assert row["fqdn"] == "budget.example.com"


def test_post_nginx_site_cert_missing_rolls_back_hostnames(nginx_client):
    client, _runner, db, _letsencrypt = nginx_client
    claim_hostnames(db, "budget", ["old.example.com"])
    spec = _site_spec().model_dump()
    response = client.post("/v1/nginx/sites", json={"spec": spec})
    assert response.status_code == 400
    assert "certificate for example.com not issued" in response.json()["detail"]
    with db.connect() as conn:
        row = conn.execute("SELECT fqdn FROM hostname WHERE site = ?", ("budget",)).fetchone()
    assert row["fqdn"] == "old.example.com"


def test_post_nginx_site_nginx_test_error_returns_422(nginx_client):
    client, runner, db, letsencrypt = nginx_client
    _touch_cert(letsencrypt, "example.com")
    runner.responses.clear()
    runner.on("nginx -t", stderr="bad config\n", returncode=1)
    spec = _site_spec().model_dump()
    response = client.post("/v1/nginx/sites", json={"spec": spec})
    assert response.status_code == 422
    assert response.json()["detail"] == "bad config"
    with db.connect() as conn:
        assert conn.execute("SELECT 1 FROM hostname WHERE site = ?", ("budget",)).fetchone() is None


def test_get_nginx_sites_lists_hostnames(nginx_client):
    client, _runner, db, _letsencrypt = nginx_client
    claim_hostnames(db, "budget", ["budget.example.com"])
    response = client.get("/v1/nginx/sites")
    assert response.status_code == 200
    assert response.json() == [{"site_id": "budget", "hostnames": ["budget.example.com"]}]
