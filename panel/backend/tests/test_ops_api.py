import json
from datetime import timedelta

import httpx
import pyotp
import pytest
from conftest import login, totp_code

import vpscp_panel.db as db_module
from vpscp_panel.models import Project
from vpscp_panel.panel_events import record_panel_event


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
def ops_transport(agent_requests):
    dump_bytes = b"PGDMP"

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/firewall/rules":
            if request.method == "GET":
                return httpx.Response(200, json=[{"number": 1}])
            return httpx.Response(200, json={"status": "ok"})
        if path == "/v1/firewall/exposure":
            return httpx.Response(200, json=[])
        if path.startswith("/v1/firewall/rules/") and request.method == "DELETE":
            assert request.url.params.get("client_ip") == "198.51.100.2"
            return httpx.Response(200, json={"status": "ok"})
        if path == "/v1/firewall/cloudflare-only":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/v1/backup/settings":
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "bucket": "b",
                        "schedule_hours": "12",
                        "schedule_minute": 30,
                        "timezone": "UTC",
                        "retention_days": 30,
                        "credentials_configured": True,
                        "client_email": "svc@example.com",
                        "archive_passphrase_set": False,
                    },
                )
            return httpx.Response(200, json={"bucket": "b", "schedule_hours": "12"})
        if path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={"last_run": None, "trigger_pending": False, "container": "backup"},
            )
        if path == "/v1/backup/test":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/backup/run-now":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/v1/db/databases":
            return httpx.Response(
                200,
                json=[
                    {
                        "name": "mydb",
                        "owner": "mydb_user",
                        "size_bytes": 1,
                        "attached_slug": "app",
                    }
                ],
            )
        if path == "/v1/db/adopt":
            return httpx.Response(200, json={"password": "new-db-password-32chars-long"})
        if path == "/v1/db/rotate-password":
            return httpx.Response(200, json={"password": "rotated-db-password-32chars"})
        if path == "/v1/db/drop":
            return httpx.Response(204)
        if path == "/v1/db/dumps/myapp":
            if request.method == "GET" and path.count("/") == 4:
                return httpx.Response(200, content=dump_bytes)
            return httpx.Response(200, json=[{"name": "dump.sql", "size_bytes": 5}])
        if path == "/v1/projects/myapp/env" and request.method == "PATCH":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/registry/status":
            return httpx.Response(200, json={"configured": False})
        if path == "/v1/registry/credentials":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/audit":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 1,
                        "ts": "2025-06-15T11:00:00+00:00",
                        "operation": "db.create",
                        "params": {"name": "a"},
                        "ok": True,
                        "error": None,
                        "duration_ms": 3,
                    }
                ],
            )
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


@pytest.fixture
def ops_client(client_factory, ops_transport):
    with client_factory(transport=ops_transport) as client:
        yield client


@pytest.fixture
def auth(ops_client, admin_user, frozen_time):
    return login(ops_client, admin_user, frozen_time)


def test_firewall_delete_ignores_forged_cf_connecting_ip(
    ops_client, auth, admin_user, frozen_time, agent_requests
):
    """CF-Connecting-IP is caller-controlled and passes through nginx unchanged;
    trusting it lets a session thief spoof the SSH-lockout guardrail's idea of
    the client's source IP. Only the nginx-set X-Real-IP counts."""
    step_up(ops_client, auth, admin_user, frozen_time + timedelta(seconds=31))
    response = ops_client.request(
        "DELETE",
        "/api/firewall/rules/2",
        headers={
            **csrf_headers(auth),
            "X-Real-IP": "198.51.100.2",
            "CF-Connecting-IP": "203.0.113.99",
        },
        json={
            "to": "any",
            "proto": "tcp",
            "action": "ALLOW",
            "from": "any",
            "v6": False,
            "comment": "",
        },
    )
    assert response.status_code in (200, 204, 409)
    for request in agent_requests:
        if request.url.path.endswith("/firewall/rules/2") and request.method == "DELETE":
            assert request.url.params.get("client_ip") == "198.51.100.2"


def test_firewall_delete_injects_client_ip(
    ops_client, auth, admin_user, frozen_time, agent_requests
):
    step_up(ops_client, auth, admin_user, frozen_time + timedelta(seconds=31))
    response = ops_client.request(
        "DELETE",
        "/api/firewall/rules/2",
        headers={**csrf_headers(auth), "X-Real-IP": "198.51.100.2"},
        json={
            "to": "any",
            "proto": "tcp",
            "action": "ALLOW",
            "from": "any",
            "v6": False,
            "comment": "",
        },
    )
    assert response.status_code == 200
    assert agent_requests[-1].method == "DELETE"


def test_firewall_mutation_requires_step_up(ops_client, auth):
    response = ops_client.post(
        "/api/firewall/rules",
        headers=csrf_headers(auth),
        json={
            "port": 8443,
            "proto": "tcp",
            "action": "allow",
            "source": "any",
            "comment": "",
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "step_up_required"


def test_backup_status_includes_next_run_and_overdue(ops_client, auth, frozen_time):
    response = ops_client.get("/api/backups/status")
    assert response.status_code == 200
    body = response.json()
    assert body["next_run"] == "2025-06-15T12:30:00+00:00"
    assert body["overdue"] is True


def test_backup_put_credentials_requires_step_up(ops_client, auth):
    response = ops_client.put(
        "/api/backups/settings",
        headers=csrf_headers(auth),
        json={
            "bucket": "my-bucket",
            "schedule_hours": "0",
            "schedule_minute": 0,
            "timezone": "UTC",
            "retention_days": 30,
            "service_account": "{}",
        },
    )
    assert response.status_code == 403


def test_backup_clear_passphrase_requires_step_up(ops_client, auth):
    response = ops_client.put(
        "/api/backups/settings",
        headers=csrf_headers(auth),
        json={
            "bucket": "my-bucket",
            "schedule_hours": "0",
            "schedule_minute": 0,
            "timezone": "UTC",
            "retention_days": 30,
            "archive_passphrase": "",
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "step_up_required"


def test_database_databases_lists_attached(ops_client, auth):
    response = ops_client.get("/api/database/databases")
    assert response.status_code == 200
    assert response.json()[0]["attached_slug"] == "app"


def test_audit_merges_panel_and_agent(ops_client, auth, frozen_time):
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        record_panel_event(
            db,
            "auth.login_success",
            {"username": "admin"},
            ok=True,
            duration_ms=1,
            ts=frozen_time,
        )
    response = ops_client.get("/api/audit")
    assert response.status_code == 200
    body = response.json()
    assert "entries" in body
    sources = {row["source"] for row in body["entries"]}
    assert sources == {"agent", "panel"}


def test_account_password_change(ops_client, auth, admin_user, frozen_time):
    when = frozen_time + timedelta(seconds=31)
    code = totp_code(admin_user["totp_secret"], when)
    response = ops_client.post(
        "/api/account/password",
        headers=csrf_headers(auth),
        json={
            "current_password": admin_user["password"],
            "new_password": "new-password-12",
            "code": code,
        },
    )
    assert response.status_code == 200


def test_account_totp_reset_and_confirm(ops_client, auth, admin_user, frozen_time):
    step_time = frozen_time + timedelta(seconds=31)
    step_up(ops_client, auth, admin_user, step_time)
    reset = ops_client.post("/api/account/totp/reset", headers=csrf_headers(auth))
    assert reset.status_code == 200
    secret = reset.json()["secret"]
    confirm_code = pyotp.TOTP(secret).at(frozen_time)
    confirm = ops_client.post(
        "/api/account/totp/confirm",
        headers=csrf_headers(auth),
        json={"code": confirm_code},
    )
    assert confirm.status_code == 200


def test_registry_requires_step_up(ops_client, auth):
    response = ops_client.post(
        "/api/settings/registry",
        headers=csrf_headers(auth),
        json={"username": "user", "token": "token-value"},
    )
    assert response.status_code == 403


def test_database_adopt_requires_step_up(ops_client, auth):
    response = ops_client.post(
        "/api/database/adopt",
        headers=csrf_headers(auth),
        json={
            "slug": "myapp",
            "db_name": "mydb",
            "db_user": "mydb_user",
            "password_mode": "rotate",
        },
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "step_up_required"}


def test_database_adopt_writes_env(ops_client, auth, frozen_time, admin_user, agent_requests):
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        db.add(
            Project(
                slug="myapp",
                display_name="My App",
                repo_url="https://github.com/o/r.git",
                branch="main",
                compose_file="docker-compose.yml",
                deploy_mode="build",
                docker_hub_repo=None,
                database_mode="none",
                db_name=None,
                db_user=None,
                write_database_url=True,
                migration_command=None,
                migration_service=None,
                health_check_url=None,
                user_env=None,
                creation_state=json.dumps({"status": "ready", "steps": []}),
                created_at=frozen_time,
            )
        )
        db.commit()

    step_up(ops_client, auth, admin_user, frozen_time + timedelta(seconds=31))
    response = ops_client.post(
        "/api/database/adopt",
        headers=csrf_headers(auth),
        json={
            "slug": "myapp",
            "db_name": "mydb",
            "db_user": "mydb_user",
            "password_mode": "rotate",
            "write_database_url": True,
        },
    )
    assert response.status_code == 200
    patch_req = next(r for r in agent_requests if r.url.path.endswith("/env"))
    body = json.loads(patch_req.content)
    assert "POSTGRES_PASSWORD" in body["set"]
    assert response.json() == {"restart_required": True}
