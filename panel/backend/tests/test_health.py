import httpx
from conftest import login


def test_health_reports_ok_and_version(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_agent_health_proxy(client_factory, admin_user, frozen_time):
    agent_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        if request.url.path == "/v1/health":
            return httpx.Response(200, json={"status": "ok", "version": "9.9.9-agent"})
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    login(client, admin_user, frozen_time)

    response = client.get("/api/health/agent")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "9.9.9-agent"}
    assert any(req.url.path == "/v1/health" for req in agent_requests)
