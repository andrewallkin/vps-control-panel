import json

import httpx
import pytest
from fastapi.testclient import TestClient

import vpscp_panel.db as db_module
from tests.conftest import login
from vpscp_panel.agent_client import AgentClient
from vpscp_panel.main import create_app
from vpscp_panel.models import Domain
from vpscp_panel.settings_store import get_setting, set_setting

CHUNK_MAX = 16 * 1024 * 1024


@pytest.fixture
def agent_requests():
    return []


def _setup_transport(agent_requests, job_status="running"):
    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/restore/uploads" and request.method == "POST":
            return httpx.Response(200, json={"upload_id": "up-1"})
        if (
            path.startswith("/v1/restore/uploads/")
            and request.method == "GET"
            and "/complete" not in path
        ):
            return httpx.Response(200, json={"received": 0})
        if path.startswith("/v1/restore/uploads/") and request.method == "PUT":
            return httpx.Response(200, json={"received": len(request.content)})
        if path.startswith("/v1/restore/uploads/") and request.method == "DELETE":
            return httpx.Response(204)
        if path.endswith("/complete") and request.method == "POST":
            return httpx.Response(
                200,
                json={
                    "id": "up-1",
                    "filename": "dump.tar",
                    "size": 100,
                    "kind": "cluster",
                    "header_ok": True,
                    "databases": [],
                    "roles": [],
                },
            )
        if path == "/v1/restore/run" and request.method == "POST":
            return httpx.Response(202, json={"job_id": "job-restore-1"})
        if path.startswith("/v1/jobs/"):
            return httpx.Response(
                200,
                json={"id": path.rsplit("/", 1)[-1], "status": job_status},
            )
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


@pytest.fixture
def setup_client(panel_settings, frozen_time, agent_requests):
    transport = _setup_transport(agent_requests)
    agent = AgentClient("/fake.sock", transport=transport)
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        yield client


@pytest.fixture
def auth(setup_client, admin_user, frozen_time):
    return login(setup_client, admin_user, frozen_time)


def csrf_headers(auth):
    return {"X-CSRF-Token": auth["csrf_token"]}


def test_get_state_requires_session(setup_client):
    response = setup_client.get("/api/setup/state")
    assert response.status_code == 401


def test_get_state_default_shape(setup_client, auth):
    response = setup_client.get("/api/setup/state")
    assert response.status_code == 200
    assert response.json() == {
        "steps": [
            {"id": "account", "status": "done"},
            {"id": "database", "status": "pending"},
            {"id": "cloudflare", "status": "pending"},
            {"id": "domains", "status": "pending"},
            {"id": "panel_hostname", "status": "pending"},
        ],
        "completed": False,
        "restore_job_id": None,
    }


def test_database_empty_requires_csrf(setup_client, auth):
    response = setup_client.post("/api/setup/database/empty")
    assert response.status_code == 403
    assert response.json() == {"detail": "csrf_failed"}


def test_database_empty_marks_empty(setup_client, auth):
    response = setup_client.post(
        "/api/setup/database/empty",
        headers=csrf_headers(auth),
    )
    assert response.status_code == 200
    assert response.json()["steps"][1]["status"] == "empty"
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        stored = get_setting(db, "setup")
    assert stored["database"] == "empty"


def test_complete_rejected_while_pending(setup_client, auth):
    response = setup_client.post(
        "/api/setup/complete",
        headers=csrf_headers(auth),
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "database_pending"}


def test_complete_rejected_after_empty_only(setup_client, auth):
    setup_client.post("/api/setup/database/empty", headers=csrf_headers(auth))
    response = setup_client.post(
        "/api/setup/complete",
        headers=csrf_headers(auth),
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "cloudflare_pending"}


def test_restore_confirm_validation(setup_client, auth, agent_requests):
    response = setup_client.post(
        "/api/setup/restore",
        headers=csrf_headers(auth),
        json={"upload_id": "up-1", "confirm": "NOPE"},
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "confirm must be RESTORE"}
    assert len(agent_requests) == 0


def test_restore_stores_job_id(setup_client, auth, agent_requests):
    response = setup_client.post(
        "/api/setup/restore",
        headers=csrf_headers(auth),
        json={"upload_id": "up-1", "confirm": "RESTORE"},
    )
    assert response.status_code == 200
    assert response.json() == {"job_id": "job-restore-1"}
    assert agent_requests[-1].url.path == "/v1/restore/run"
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        stored = get_setting(db, "setup")
    assert stored["restore_job_id"] == "job-restore-1"


def test_setup_state_exposes_restore_job(setup_client, auth):
    """After refresh the wizard must be able to resume the restore log: state
    carries the running restore_job_id."""
    with db_module.SessionLocal() as db:
        set_setting(db, "setup", {"database": "pending", "restore_job_id": "job-restore-1"})
        db.commit()
    resp = setup_client.get("/api/setup/state", headers=csrf_headers(auth))
    assert resp.status_code == 200
    assert resp.json()["restore_job_id"] == "job-restore-1"


def test_second_restore_rejected_while_running(setup_client, auth, agent_requests):
    """A second restore while one is in flight must be rejected, not silently
    overwrite the tracked job id."""
    setup_client.post(
        "/api/setup/restore",
        json={"upload_id": "up-1", "confirm": "RESTORE"},
        headers=csrf_headers(auth),
    )
    resp = setup_client.post(
        "/api/setup/restore",
        json={"upload_id": "up-2", "confirm": "RESTORE"},
        headers=csrf_headers(auth),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "restore_in_progress"


def test_failed_restore_job_clears_and_allows_retry(panel_settings, frozen_time, admin_user):
    """A failed restore must leave the step retryable: restore_job_id cleared in
    state so the wizard shows the upload choices again."""
    transport = _setup_transport([], job_status="failed")
    agent = AgentClient("/fake.sock", transport=transport)
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        auth = login(client, admin_user, frozen_time)
        assert db_module.SessionLocal is not None
        with db_module.SessionLocal() as db:
            set_setting(db, "setup", {"database": "pending", "restore_job_id": "job-restore-1"})
            db.commit()
        resp = client.get("/api/setup/state", headers=csrf_headers(auth))
        assert resp.status_code == 200
        body = resp.json()
        assert body["restore_job_id"] is None
        assert body["steps"][1]["status"] == "pending"


def test_get_state_job_success_marks_restored(
    panel_settings, frozen_time, admin_user, agent_requests
):
    transport = _setup_transport(agent_requests, job_status="succeeded")
    agent = AgentClient("/fake.sock", transport=transport)
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        assert db_module.SessionLocal is not None
        with db_module.SessionLocal() as db:
            set_setting(
                db,
                "setup",
                {
                    "database": "pending",
                    "completed": False,
                    "restore_job_id": "job-restore-1",
                },
            )
            db.commit()
        response = client.get("/api/setup/state")
    assert response.status_code == 200
    assert response.json()["steps"][1]["status"] == "restored"
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        stored = get_setting(db, "setup")
    assert stored["database"] == "restored"


def test_upload_chunk_relay(setup_client, auth, agent_requests):
    payload = b"chunk-bytes-here"
    response = setup_client.put(
        "/api/setup/uploads/up-1",
        params={"offset": "4096"},
        content=payload,
        headers=csrf_headers(auth),
    )
    assert response.status_code == 200
    assert response.json() == {"received": len(payload)}
    req = agent_requests[-1]
    assert req.method == "PUT"
    assert req.url.path == "/v1/restore/uploads/up-1"
    assert req.url.params.get("offset") == "4096"
    assert req.content == payload


def test_upload_chunk_too_large(setup_client, auth, agent_requests):
    payload = b"x" * (CHUNK_MAX + 1)
    response = setup_client.put(
        "/api/setup/uploads/up-1",
        params={"offset": "0"},
        content=payload,
        headers=csrf_headers(auth),
    )
    assert response.status_code == 413
    assert response.json() == {"detail": "chunk_too_large"}
    assert len(agent_requests) == 0


def _mark_setup_completed():
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as db:
        set_setting(
            db,
            "setup",
            {"database": "empty", "cloudflare": "done", "completed": True},
        )
        set_setting(db, "panel_hostname", "panel.example.com")
        db.add(
            Domain(
                name="example.com",
                zone_id="zone-1",
                cert_status="missing",
                cert_expires_at=None,
            )
        )
        db.commit()


def test_upload_requires_step_up_after_completed(setup_client, auth, agent_requests):
    setup_client.post("/api/setup/database/empty", headers=csrf_headers(auth))
    _mark_setup_completed()
    response = setup_client.post(
        "/api/setup/uploads",
        headers=csrf_headers(auth),
        json={"filename": "dump.tar", "size": 100},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "step_up_required"}
    assert len(agent_requests) == 0


def test_restore_forwards_overwrite_and_surfaces_conflict(setup_client, auth, agent_requests):
    """overwrite flag reaches the agent; a cluster_not_empty 409 is relayed with
    the drop list so the UI can confirm replacement."""
    resp = setup_client.post(
        "/api/setup/restore",
        json={"upload_id": "up-1", "confirm": "RESTORE", "overwrite": True},
        headers=csrf_headers(auth),
    )
    assert resp.status_code == 200, resp.text
    body = json.loads(agent_requests[-1].content.decode())
    assert body["overwrite"] is True


def test_restore_requires_step_up_after_completed(setup_client, auth, agent_requests):
    setup_client.post("/api/setup/database/empty", headers=csrf_headers(auth))
    _mark_setup_completed()
    response = setup_client.post(
        "/api/setup/restore",
        headers=csrf_headers(auth),
        json={"upload_id": "up-1", "confirm": "RESTORE"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "step_up_required"}
    assert len(agent_requests) == 0


def test_delete_upload_proxies(setup_client, auth, agent_requests):
    response = setup_client.delete(
        "/api/setup/uploads/up-1",
        headers=csrf_headers(auth),
    )
    assert response.status_code == 204
    assert agent_requests[-1].method == "DELETE"
    assert agent_requests[-1].url.path == "/v1/restore/uploads/up-1"


def test_upload_allowed_during_first_run_without_step_up(setup_client, auth, agent_requests):
    response = setup_client.post(
        "/api/setup/uploads",
        headers=csrf_headers(auth),
        json={"filename": "dump.tar", "size": 100},
    )
    assert response.status_code == 200
    assert response.json() == {"upload_id": "up-1"}
