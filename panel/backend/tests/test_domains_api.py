import json
from datetime import timedelta

import httpx
import pyotp
import pytest
from fastapi.testclient import TestClient

import vpscp_panel.db as db_module
from vpscp_panel.agent_client import AgentClient
from vpscp_panel.main import create_app
from vpscp_panel.settings_store import get_setting, set_setting

SECRET_TOKEN = "cf-secret-token-should-not-leak"
DOMAIN = "example.com"
ZONE_ID = "zone-1"


def totp_code(secret: str, when):
    return pyotp.TOTP(secret).at(when)


def login(client, admin_user, when):
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


def csrf_headers(auth):
    return {"X-CSRF-Token": auth["csrf_token"]}


def step_up(client, auth, admin_user, when):
    code = totp_code(admin_user["totp_secret"], when)
    return client.post(
        "/api/auth/step-up",
        json={"code": code},
        headers=csrf_headers(auth),
    )


@pytest.fixture
def agent_requests():
    return []


@pytest.fixture
def agent_state():
    return {
        "credentials": False,
        "domains": [],
        "tls": [],
        "ssl_modes": {"zone-1": "full"},
        "panel_site": None,
        "dns_upserts": [],
    }


def _domains_transport(agent_requests, agent_state):
    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        method = request.method

        if path == "/v1/dns/credentials" and method == "POST":
            body = json.loads(request.content.decode())
            assert body.get("token") == SECRET_TOKEN
            agent_state["credentials"] = True
            return httpx.Response(
                200,
                json={
                    "zones": [
                        {"id": ZONE_ID, "name": DOMAIN, "status": "active"},
                    ]
                },
            )
        if path == "/v1/dns/zones" and method == "GET":
            if not agent_state["credentials"]:
                return httpx.Response(
                    400,
                    json={"detail": "Cloudflare credentials are not configured"},
                )
            return httpx.Response(
                200,
                json=[{"id": ZONE_ID, "name": DOMAIN, "status": "active"}],
            )
        if path.endswith("/ssl-mode") and method == "GET":
            zone_id = path.rsplit("/", 2)[-2]
            mode = agent_state["ssl_modes"].get(zone_id, "strict")
            return httpx.Response(200, json={"mode": mode})
        if path == "/v1/domains" and method == "POST":
            body = json.loads(request.content.decode())
            agent_state["domains"].append(body)
            return httpx.Response(201, json=body)
        if path.startswith("/v1/domains/") and method == "DELETE":
            name = path.rsplit("/", 1)[-1]
            agent_state["domains"] = [d for d in agent_state["domains"] if d.get("name") != name]
            return httpx.Response(204)
        if path == "/v1/tls/issue" and method == "POST":
            if agent_state.get("issue_error"):
                return httpx.Response(400, json={"detail": agent_state["issue_error"]})
            return httpx.Response(202, json={"job_id": "job-tls-1"})
        if path == "/v1/tls/status" and method == "GET":
            return httpx.Response(200, json=agent_state["tls"])
        if path == "/v1/nginx/sites" and method == "POST":
            body = json.loads(request.content.decode())
            agent_state["panel_site"] = body
            return httpx.Response(200, json={"site_id": "vpscp-panel"})
        if path == "/v1/dns/records/upsert" and method == "POST":
            body = json.loads(request.content.decode())
            agent_state["dns_upserts"].append(body)
            return httpx.Response(200, json={"fqdn": body["fqdn"]})
        if path == "/v1/server/settings":
            if method == "GET":
                return httpx.Response(
                    200,
                    json={"public_ipv4": "203.0.113.1", "acme_email": "a@example.com"},
                )
            if method == "PUT":
                return httpx.Response(200, json=json.loads(request.content.decode()))
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


@pytest.fixture
def domains_client(panel_settings, frozen_time, agent_requests, agent_state):
    transport = _domains_transport(agent_requests, agent_state)
    agent = AgentClient("/fake.sock", transport=transport)
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        yield client


@pytest.fixture
def auth(domains_client, admin_user, frozen_time):
    return login(domains_client, admin_user, frozen_time)


def _post_token(client, auth):
    return client.post(
        "/api/cloudflare/token",
        json={"token": SECRET_TOKEN},
        headers=csrf_headers(auth),
    )


def _register_domain(client, auth):
    return client.post(
        "/api/domains",
        json={"name": DOMAIN, "zone_id": ZONE_ID},
        headers=csrf_headers(auth),
    )


def test_cloudflare_token_not_stored_in_panel(domains_client, auth, agent_requests):
    response = _post_token(domains_client, auth)
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["zones"][0]["name"] == DOMAIN
    assert SECRET_TOKEN not in response.text
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        setup = get_setting(db, "setup")
    assert setup.get("cloudflare") == "done"
    assert agent_requests[0].url.path == "/v1/dns/credentials"


def test_cloudflare_zones_unconfigured(domains_client, auth):
    response = domains_client.get("/api/cloudflare/zones")
    assert response.status_code == 200
    assert response.json() == {"configured": False, "zones": []}


def test_cloudflare_token_requires_step_up_after_setup(
    domains_client, auth, admin_user, frozen_time, agent_requests
):
    _post_token(domains_client, auth)
    _register_domain(domains_client, auth)
    domains_client.post(
        "/api/panel-hostname",
        json={"domain": DOMAIN, "subdomain": "panel"},
        headers=csrf_headers(auth),
    )
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        set_setting(db, "setup", {"database": "empty", "cloudflare": "done", "completed": True})
        db.commit()
    agent_requests.clear()
    response = domains_client.post(
        "/api/cloudflare/token",
        json={"token": SECRET_TOKEN},
        headers=csrf_headers(auth),
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "step_up_required"}
    assert len(agent_requests) == 0
    step_time = frozen_time + timedelta(seconds=31)
    domains_client.app.state.clock = lambda: step_time
    step_response = step_up(domains_client, auth, admin_user, step_time)
    assert step_response.status_code == 200, step_response.text
    response = domains_client.post(
        "/api/cloudflare/token",
        json={"token": SECRET_TOKEN},
        headers=csrf_headers(auth),
    )
    assert response.status_code == 200, response.text


def test_register_domain_returns_job_id(domains_client, auth, agent_state):
    _post_token(domains_client, auth)
    response = _register_domain(domains_client, auth)
    assert response.status_code == 200
    assert response.json() == {"job_id": "job-tls-1", "issue_error": None}
    assert len(agent_state["domains"]) == 1


def test_server_settings_accept_acme_email_during_setup(domains_client, auth, agent_requests):
    """acme_email must be settable before setup completes (the wizard needs it
    before the first cert issuance)."""
    response = domains_client.put(
        "/api/server-settings",
        json={"acme_email": "ops@example.com"},
        headers=csrf_headers(auth),
    )
    assert response.status_code == 200, response.text
    assert response.json()["acme_email"] == "ops@example.com"
    assert any(r.url.path == "/v1/server/settings" for r in agent_requests)


def test_register_domain_tolerates_issue_failure(domains_client, auth, agent_state):
    """Domain must be registered even when cert issuance fails (e.g. acme_email missing).

    The old behavior raised and returned 400/500 after the domain was already
    created agent-side, erasing the fact it was registered and dead-locking the
    wizard (the only fix was SettingsPage, which is unreachable during setup).
    """
    _post_token(domains_client, auth)
    agent_state["issue_error"] = "acme_email is not configured"
    response = _register_domain(domains_client, auth)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_id"] is None
    assert "acme_email" in body["issue_error"]
    assert len(agent_state["domains"]) == 1
    listed = domains_client.get("/api/domains")
    assert listed.status_code == 200
    assert listed.json()[0]["name"] == DOMAIN


def test_register_domain_reports_issue_job_on_success(domains_client, auth, agent_state):
    _post_token(domains_client, auth)
    response = _register_domain(domains_client, auth)
    assert response.status_code == 200
    body = response.json()
    assert body["job_id"] == "job-tls-1"
    assert body.get("issue_error") is None


def test_delete_refused_when_panel_hostname_uses_domain(domains_client, auth):
    _post_token(domains_client, auth)
    _register_domain(domains_client, auth)
    domains_client.post(
        "/api/panel-hostname",
        json={"domain": DOMAIN, "subdomain": "panel"},
        headers=csrf_headers(auth),
    )
    response = domains_client.delete(
        f"/api/domains/{DOMAIN}",
        headers=csrf_headers(auth),
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "domain_in_use_by_panel_hostname"}


def test_panel_hostname_posts_site_spec_and_dns(domains_client, auth, agent_state, agent_requests):
    _post_token(domains_client, auth)
    _register_domain(domains_client, auth)
    response = domains_client.post(
        "/api/panel-hostname",
        json={"domain": DOMAIN, "subdomain": "panel"},
        headers=csrf_headers(auth),
    )
    assert response.status_code == 200
    assert response.json() == {"panel_hostname": f"panel.{DOMAIN}"}
    spec = agent_state["panel_site"]["spec"]
    assert spec["site_id"] == "vpscp-panel"
    assert spec["panel"] is True
    assert spec["hostnames"] == [{"fqdn": f"panel.{DOMAIN}", "domain": DOMAIN, "kind": "primary"}]
    assert spec["routes"] == [
        {"path": "/", "port": 8080, "max_body_mb": 32, "read_timeout_s": 3600}
    ]
    assert agent_state["dns_upserts"] == [{"fqdn": f"panel.{DOMAIN}"}]
    nginx_calls = [r for r in agent_requests if r.url.path == "/v1/nginx/sites"]
    assert len(nginx_calls) == 1


def test_list_domains_ssl_mode_warning(domains_client, auth, agent_state):
    _post_token(domains_client, auth)
    _register_domain(domains_client, auth)
    agent_state["ssl_modes"][ZONE_ID] = "full"
    response = domains_client.get("/api/domains")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["warning"] == "Set SSL/TLS mode to Full (strict) in Cloudflare."
    agent_state["ssl_modes"][ZONE_ID] = "strict"
    response = domains_client.get("/api/domains")
    assert response.json()[0]["warning"] is None


def test_dashboard_cert_expiring_warning(panel_settings, frozen_time, admin_user, agent_state):
    soon = (frozen_time + timedelta(days=10)).replace(microsecond=0)

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={"last_run": None, "trigger_pending": False, "container": "backup"},
            )
        if path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        if path == "/v1/tls/status":
            return httpx.Response(
                200,
                json=[
                    {
                        "domain": DOMAIN,
                        "exists": True,
                        "not_after": soon.isoformat(),
                        "days_left": 10,
                        "sans": [],
                    }
                ],
            )
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["nearest_cert_expiry"] == soon.isoformat()
    assert {
        "level": "warning",
        "code": "cert_expiring_soon",
        "message": "A TLS certificate expires in under 14 days",
    } in body["warnings"]
