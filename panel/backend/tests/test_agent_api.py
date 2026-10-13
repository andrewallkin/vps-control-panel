from datetime import timedelta

import httpx
import pyotp
import pytest
from fastapi.testclient import TestClient

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.main import create_app


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


@pytest.fixture
def agent_requests():
    return []


@pytest.fixture
def mock_transport(agent_requests):
    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/metrics/current":
            return httpx.Response(
                200,
                json={"cpus": [], "mem_percent": 50.0, "disks": []},
            )
        if path == "/v1/metrics/history":
            return httpx.Response(200, json={"samples": []})
        if path == "/v1/metrics/containers":
            return httpx.Response(200, json={"containers": []})
        if path == "/v1/docker/df":
            return httpx.Response(200, json={"images": []})
        if path == "/v1/docker/prune-images":
            return httpx.Response(200, json={"reclaimed": 0})
        if path == "/v1/docker/prune-build-cache":
            return httpx.Response(200, json={"reclaimed": 0})
        if path.startswith("/v1/jobs/") and path.endswith("/events"):
            return httpx.Response(200, content=b"event: ping\ndata: {}\n\n")
        if path.startswith("/v1/jobs/"):
            return httpx.Response(200, json={"id": "job-1", "status": "done"})
        if path == "/v1/audit":
            return httpx.Response(200, json={"entries": []})
        if path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={"last_run": None, "trigger_pending": False, "container": "backup"},
            )
        if path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        if path == "/v1/tls/status":
            return httpx.Response(200, json=[])
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


@pytest.fixture
def api_client(panel_settings, frozen_time, mock_transport):
    agent = AgentClient("/fake.sock", transport=mock_transport)
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        yield client


@pytest.fixture
def auth(api_client, admin_user, frozen_time):
    return login(api_client, admin_user, frozen_time)


def test_unauthenticated_metrics_current_returns_401(api_client):
    response = api_client.get("/api/metrics/current")
    assert response.status_code == 401


def test_metrics_current_proxies(api_client, auth, agent_requests):
    response = api_client.get("/api/metrics/current")
    assert response.status_code == 200
    assert response.json()["mem_percent"] == 50.0
    assert len(agent_requests) == 1
    assert agent_requests[0].url.path == "/v1/metrics/current"


def test_metrics_history_forwards_hours(api_client, auth, agent_requests):
    response = api_client.get("/api/metrics/history", params={"hours": "24"})
    assert response.status_code == 200
    assert agent_requests[-1].url.path == "/v1/metrics/history"
    assert agent_requests[-1].url.params.get("hours") == "24"


@pytest.fixture
def mock_transport_agent_list_shapes(agent_requests):
    history_point = {
        "ts": "2026-01-01T00:00:00+00:00",
        "cpu_percent": 12.5,
        "load1": 0.5,
        "mem_used": 1000,
        "mem_total": 8000,
        "swap_used": 0,
        "swap_total": 2000,
        "disks": [
            {"path": "/", "total": 100, "used": 50, "free": 50, "percent": 50.0},
        ],
    }
    container_row = {
        "name": "web",
        "project": "app",
        "cpu_percent": 1.2,
        "mem_used": 100_000_000,
        "mem_limit": 500_000_000,
        "mem_percent": 20.0,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/metrics/history":
            return httpx.Response(200, json=[history_point])
        if path == "/v1/metrics/containers":
            return httpx.Response(200, json=[container_row])
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


@pytest.fixture
def api_client_agent_list_shapes(panel_settings, frozen_time, mock_transport_agent_list_shapes):
    agent = AgentClient("/fake.sock", transport=mock_transport_agent_list_shapes)
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        yield client


def test_metrics_history_proxies_agent_list_shape(
    api_client_agent_list_shapes, admin_user, frozen_time, agent_requests
):
    auth = login(api_client_agent_list_shapes, admin_user, frozen_time)
    assert auth
    response = api_client_agent_list_shapes.get("/api/metrics/history")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["ts"] == "2026-01-01T00:00:00+00:00"
    assert body[0]["cpu_percent"] == 12.5
    assert agent_requests[-1].url.path == "/v1/metrics/history"


def test_metrics_containers_proxies_agent_list_shape(
    api_client_agent_list_shapes, admin_user, frozen_time, agent_requests
):
    auth = login(api_client_agent_list_shapes, admin_user, frozen_time)
    assert auth
    response = api_client_agent_list_shapes.get("/api/metrics/containers")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["name"] == "web"
    assert body[0]["project"] == "app"
    assert agent_requests[-1].url.path == "/v1/metrics/containers"


def test_metrics_containers_proxies(api_client, auth, agent_requests):
    response = api_client.get("/api/metrics/containers")
    assert response.status_code == 200
    assert agent_requests[-1].url.path == "/v1/metrics/containers"


def test_docker_df_proxies(api_client, auth, agent_requests):
    response = api_client.get("/api/docker/df")
    assert response.status_code == 200
    assert agent_requests[-1].url.path == "/v1/docker/df"


def test_docker_prune_requires_csrf(api_client, auth):
    response = api_client.post("/api/docker/prune-images")
    assert response.status_code == 403
    assert response.json() == {"detail": "csrf_failed"}


def test_docker_prune_proxies(api_client, auth, agent_requests):
    response = api_client.post(
        "/api/docker/prune-images",
        headers={"X-CSRF-Token": auth["csrf_token"]},
    )
    assert response.status_code == 200
    assert agent_requests[-1].url.path == "/v1/docker/prune-images"
    assert agent_requests[-1].method == "POST"


def test_docker_prune_build_cache_requires_csrf(api_client, auth):
    response = api_client.post("/api/docker/prune-build-cache")
    assert response.status_code == 403
    assert response.json() == {"detail": "csrf_failed"}


def test_docker_prune_build_cache_proxies(api_client, auth, agent_requests):
    response = api_client.post(
        "/api/docker/prune-build-cache",
        headers={"X-CSRF-Token": auth["csrf_token"]},
    )
    assert response.status_code == 200
    assert agent_requests[-1].url.path == "/v1/docker/prune-build-cache"
    assert agent_requests[-1].method == "POST"


def test_job_get_proxies(api_client, auth, agent_requests):
    response = api_client.get("/api/jobs/abc123")
    assert response.status_code == 200
    assert agent_requests[-1].url.path == "/v1/jobs/abc123"


def test_job_events_sse_relay(api_client, auth, agent_requests):
    response = api_client.get("/api/jobs/abc123/events")
    assert response.status_code == 200
    assert response.content == b"event: ping\ndata: {}\n\n"
    assert response.headers.get("x-accel-buffering") == "no"
    assert agent_requests[-1].url.path == "/v1/jobs/abc123/events"


def test_audit_returns_merged_feed(api_client, auth, agent_requests):
    response = api_client.get("/api/audit", params={"limit": "10"})
    assert response.status_code == 200
    body = response.json()
    assert "entries" in body
    assert any(req.url.path == "/v1/audit" for req in agent_requests)


def test_agent_error_404_passthrough(panel_settings, frozen_time, admin_user):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "missing"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/metrics/current")
    assert response.status_code == 404
    assert response.json() == {"detail": "missing"}


@pytest.mark.parametrize("status", [400, 409])
def test_agent_error_400_409_passthrough(panel_settings, frozen_time, admin_user, status):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"detail": "agent said no"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/metrics/current")
    assert response.status_code == status
    assert response.json() == {"detail": "agent said no"}


def test_agent_error_500_becomes_502(panel_settings, frozen_time, admin_user):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"detail": "internal"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/metrics/current")
    assert response.status_code == 502
    assert response.json() == {"detail": "internal"}


def test_agent_connection_failure_502(panel_settings, frozen_time, admin_user):
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no socket")

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/metrics/current")
    assert response.status_code == 502
    assert response.json() == {"detail": "agent unavailable"}


def test_dashboard_summary_shape(api_client, auth):
    response = api_client.get("/api/dashboard/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["projects"] == {"total": 0, "up": 0, "unhealthy": 0}
    assert body["nearest_cert_expiry"] is None
    assert isinstance(body["warnings"], list)
    assert body["backup"] is not None


def test_dashboard_agent_unreachable(panel_settings, frozen_time, admin_user):
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["backup"] is None
    assert body["warnings"] == [
        {"level": "critical", "code": "agent_unreachable", "message": "Agent unreachable"}
    ]


def test_dashboard_metrics_error_keeps_backup(panel_settings, frozen_time, admin_user):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(500, json={"detail": "metrics down"})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={
                    "last_run": {
                        "success": True,
                        "finished_at": frozen_time.isoformat(),
                    },
                    "trigger_pending": False,
                    "container": "backup",
                },
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"] is not None
    assert body["backup"]["last_run"]["success"] is True
    assert not any(w["code"] == "agent_unreachable" for w in body["warnings"])
    assert not any(w["code"] in ("disk_high", "memory_high") for w in body["warnings"])


def test_dashboard_status_error_keeps_metrics_warnings(panel_settings, frozen_time, admin_user):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 91.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(500, json={"detail": "status down"})
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"] is None
    assert not any(w["code"] == "agent_unreachable" for w in body["warnings"])
    assert {"level": "warning", "code": "memory_high", "message": "Memory above 90%"} in body[
        "warnings"
    ]


def test_dashboard_status_unreachable_keeps_metrics_warnings(
    panel_settings, frozen_time, admin_user
):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 91.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            raise httpx.ConnectError("down")
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"] is None
    assert {"level": "warning", "code": "memory_high", "message": "Memory above 90%"} in body[
        "warnings"
    ]
    assert {"level": "critical", "code": "agent_unreachable", "message": "Agent unreachable"} in (
        body["warnings"]
    )


def test_dashboard_settings_error_no_overdue_warning(panel_settings, frozen_time, admin_user):
    old = frozen_time - timedelta(hours=25)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={
                    "last_run": {"success": True, "finished_at": old.isoformat()},
                    "trigger_pending": False,
                    "container": "backup",
                },
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(500, json={"detail": "settings down"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"] is not None
    assert body["backup"]["overdue"] is False
    assert not any(w["code"] == "backup_overdue" for w in body["warnings"])
    assert not any(w["code"] == "agent_unreachable" for w in body["warnings"])


def test_dashboard_unknown_schedule_null_last_run_not_overdue(
    panel_settings, frozen_time, admin_user
):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={"last_run": None, "trigger_pending": False, "container": "backup"},
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(404, json={"detail": "not found"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"] is not None
    assert body["backup"]["last_run"] is None
    assert body["backup"]["overdue"] is False
    assert not any(w["code"] == "backup_overdue" for w in body["warnings"])


@pytest.mark.parametrize("schedule_hours", ["", "   ", ","])
def test_dashboard_empty_schedule_null_last_run_not_overdue(
    panel_settings, frozen_time, admin_user, schedule_hours
):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={"last_run": None, "trigger_pending": False, "container": "backup"},
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": schedule_hours})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"]["overdue"] is False
    assert not any(w["code"] == "backup_overdue" for w in body["warnings"])


def test_dashboard_known_schedule_null_last_run_is_overdue(panel_settings, frozen_time, admin_user):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={"last_run": None, "trigger_pending": False, "container": "backup"},
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["backup"]["overdue"] is True
    assert {"level": "warning", "code": "backup_overdue", "message": "Backup overdue"} in body[
        "warnings"
    ]


def test_dashboard_disk_warning(panel_settings, frozen_time, admin_user):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(
                200,
                json={
                    "cpus": [],
                    "mem_percent": 50.0,
                    "disks": [
                        {"path": "/data", "total": 100, "used": 90, "free": 10, "percent": 86}
                    ],
                },
            )
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={
                    "last_run": {
                        "success": True,
                        "finished_at": frozen_time.isoformat(),
                    },
                    "trigger_pending": False,
                    "container": "backup",
                },
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    warnings = response.json()["warnings"]
    assert any(w["code"] == "disk_high" and "/data" in w["message"] for w in warnings)


def test_dashboard_memory_warning(panel_settings, frozen_time, admin_user):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 91.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={
                    "last_run": {
                        "success": True,
                        "finished_at": frozen_time.isoformat(),
                    },
                    "trigger_pending": False,
                    "container": "backup",
                },
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    warnings = response.json()["warnings"]
    assert {"level": "warning", "code": "memory_high", "message": "Memory above 90%"} in warnings


def test_dashboard_backup_failed(panel_settings, frozen_time, admin_user):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={
                    "last_run": {"success": False, "finished_at": frozen_time.isoformat()},
                    "trigger_pending": False,
                    "container": "backup",
                },
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert body["backup"]["failed"] is True
    assert {"level": "critical", "code": "backup_failed", "message": "Backup failed"} in body[
        "warnings"
    ]


def test_dashboard_backup_overdue(panel_settings, frozen_time, admin_user):
    old = frozen_time - timedelta(hours=25)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if request.url.path == "/v1/backup/status":
            return httpx.Response(
                200,
                json={
                    "last_run": {"success": True, "finished_at": old.isoformat()},
                    "trigger_pending": False,
                    "container": "backup",
                },
            )
        if request.url.path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        return httpx.Response(404)

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    app = create_app(settings=panel_settings, agent=agent)
    app.state.clock = lambda: frozen_time
    with TestClient(app) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/dashboard/summary")
    body = response.json()
    assert body["backup"]["overdue"] is True
    assert {"level": "warning", "code": "backup_overdue", "message": "Backup overdue"} in body[
        "warnings"
    ]


@pytest.mark.asyncio
async def test_agent_client_raises_on_non_2xx():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(418, json={"detail": "teapot"})

    client = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(AgentError) as exc:
            await client.get("/v1/x")
        assert exc.value.status == 418
        assert exc.value.detail == "teapot"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_agent_client_connect_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope")

    client = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(AgentError) as exc:
            await client.get("/v1/x")
        assert exc.value.status == 503
        assert exc.value.detail == "agent unavailable"
    finally:
        await client.aclose()
