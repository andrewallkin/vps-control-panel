import json

import httpx
import pytest
from fastapi.testclient import TestClient

from vpscp_agent import audit
from vpscp_agent.cloudflare import MANAGED_BY_COMMENT
from vpscp_agent.config import load_settings
from vpscp_agent.credentials import read_cloudflare_token, write_cloudflare_ini
from vpscp_agent.main import create_app

SECRET_TOKEN = "cf-test-token-xyz"


@pytest.fixture
def dns_client(tmp_path):
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )
    transport_holder: dict[str, httpx.MockTransport] = {}

    def factory(token: str, transport=None):
        from vpscp_agent.cloudflare import CloudflareClient

        tr = transport_holder.get("transport")
        return CloudflareClient(token, transport=tr)

    with TestClient(create_app(settings)) as client:
        client.app.state.cloudflare_client_factory = factory
        yield client, transport_holder, settings


def _register_domain(client: TestClient, name: str, zone_id: str) -> None:
    resp = client.post("/v1/domains", json={"name": name, "zone_id": zone_id})
    assert resp.status_code == 201


def _set_public_ipv4(client: TestClient, ip: str) -> None:
    resp = client.put("/v1/server/settings", json={"public_ipv4": ip})
    assert resp.status_code == 200


def test_post_credentials_audited_token_masked(dns_client):
    client, transport_holder, settings = dns_client

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/tokens/verify"):
            return httpx.Response(
                200,
                json={"success": True, "result": {"status": "active"}},
            )
        if request.url.path.endswith("/zones"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [{"id": "zone-1", "name": "example.com", "status": "active"}],
                    "result_info": {"page": 1, "total_pages": 1},
                },
            )
        raise AssertionError(request.url.path)

    transport_holder["transport"] = httpx.MockTransport(handler)
    db = client.app.state.db
    before = len(audit.list_events(db))
    response = client.post("/v1/dns/credentials", json={"token": SECRET_TOKEN})
    assert response.status_code == 200
    assert response.json() == {
        "zones": [{"id": "zone-1", "name": "example.com", "status": "active"}],
    }
    assert SECRET_TOKEN not in response.text
    events = audit.list_events(db)
    assert len(events) == before + 1
    assert events[0].operation == "dns.credentials.set"
    assert events[0].params["token"] == "***"
    assert SECRET_TOKEN not in json.dumps(events[0].params)
    assert read_cloudflare_token(settings) == SECRET_TOKEN


def test_get_zones_not_audited(dns_client):
    client, transport_holder, settings = dns_client
    write_cloudflare_ini(settings, SECRET_TOKEN)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/zones"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [{"id": "z", "name": "example.com", "status": "active"}],
                    "result_info": {"page": 1, "total_pages": 1},
                },
            )
        raise AssertionError(request.url.path)

    transport_holder["transport"] = httpx.MockTransport(handler)
    db = client.app.state.db
    before = len(audit.list_events(db))
    response = client.get("/v1/dns/zones")
    assert response.status_code == 200
    assert len(audit.list_events(db)) == before


def test_upsert_create_and_update(dns_client):
    client, transport_holder, _settings = dns_client
    _register_domain(client, "example.com", "zone-1")
    _set_public_ipv4(client, "203.0.113.10")
    state = {"created": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dns_records") and request.method == "GET":
            if not state["created"]:
                return httpx.Response(200, json={"success": True, "result": []})
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [
                        {
                            "id": "rec-1",
                            "type": "A",
                            "name": "app.example.com",
                            "content": "203.0.113.10",
                            "comment": MANAGED_BY_COMMENT,
                        }
                    ],
                },
            )
        if request.url.path.endswith("/dns_records") and request.method == "POST":
            state["created"] = True
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "id": "rec-1",
                        "type": "A",
                        "name": "app.example.com",
                        "content": "203.0.113.10",
                    },
                },
            )
        if "/dns_records/rec-1" in request.url.path and request.method == "PATCH":
            body = json.loads(request.content.decode())
            assert body["content"] == "203.0.113.11"
            return httpx.Response(
                200,
                json={"success": True, "result": {"id": "rec-1", **body}},
            )
        raise AssertionError(f"{request.method} {request.url}")

    transport_holder["transport"] = httpx.MockTransport(handler)
    write_cloudflare_ini(_settings, SECRET_TOKEN)

    first = client.post("/v1/dns/records/upsert", json={"fqdn": "app.example.com"})
    assert first.status_code == 200

    _set_public_ipv4(client, "203.0.113.11")
    second = client.post("/v1/dns/records/upsert", json={"fqdn": "app.example.com"})
    assert second.status_code == 200


def test_upsert_refuses_unmanaged_without_adopt(dns_client):
    client, transport_holder, settings = dns_client
    _register_domain(client, "example.com", "zone-1")
    _set_public_ipv4(client, "203.0.113.10")
    write_cloudflare_ini(settings, SECRET_TOKEN)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dns_records"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [
                        {
                            "id": "rec-1",
                            "type": "A",
                            "name": "app.example.com",
                            "content": "1.2.3.4",
                            "comment": "manual",
                        }
                    ],
                },
            )
        raise AssertionError(request.url.path)

    transport_holder["transport"] = httpx.MockTransport(handler)
    response = client.post("/v1/dns/records/upsert", json={"fqdn": "app.example.com"})
    assert response.status_code == 400
    assert (
        "adopt" in response.json()["detail"].lower()
        or "managed" in response.json()["detail"].lower()
    )


def test_upsert_missing_zone_and_missing_public_ipv4(dns_client):
    client, transport_holder, settings = dns_client
    write_cloudflare_ini(settings, SECRET_TOKEN)
    transport_holder["transport"] = httpx.MockTransport(
        lambda _r: httpx.Response(500, json={"success": True, "result": []})
    )
    _set_public_ipv4(client, "203.0.113.10")

    no_zone = client.post("/v1/dns/records/upsert", json={"fqdn": "app.example.com"})
    assert no_zone.status_code == 400

    _register_domain(client, "example.com", "zone-1")
    client.put("/v1/server/settings", json={"public_ipv4": None})
    no_ip = client.post("/v1/dns/records/upsert", json={"fqdn": "app.example.com"})
    assert no_ip.status_code == 400


def test_delete_refuses_unmanaged(dns_client):
    client, transport_holder, settings = dns_client
    _register_domain(client, "example.com", "zone-1")
    write_cloudflare_ini(settings, SECRET_TOKEN)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [
                        {
                            "id": "rec-1",
                            "type": "A",
                            "name": "app.example.com",
                            "comment": "other",
                        }
                    ],
                },
            )
        raise AssertionError(f"{request.method} {request.url}")

    transport_holder["transport"] = httpx.MockTransport(handler)
    response = client.post("/v1/dns/records/delete", json={"fqdn": "app.example.com"})
    assert response.status_code == 400


def test_cloudflare_api_error_maps_to_502(dns_client):
    client, transport_holder, settings = dns_client
    write_cloudflare_ini(settings, SECRET_TOKEN)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500,
            json={"success": False, "errors": [{"message": "cloudflare down"}]},
        )

    transport_holder["transport"] = httpx.MockTransport(handler)
    response = client.get("/v1/dns/zones")
    assert response.status_code == 502
    assert response.json()["detail"] == "cloudflare down"


def test_ssl_mode_endpoint(dns_client):
    client, transport_holder, settings = dns_client
    write_cloudflare_ini(settings, SECRET_TOKEN)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/settings/ssl"):
            return httpx.Response(
                200,
                json={"success": True, "result": {"value": "full"}},
            )
        raise AssertionError(request.url.path)

    transport_holder["transport"] = httpx.MockTransport(handler)
    response = client.get("/v1/dns/zones/zone-1/ssl-mode")
    assert response.status_code == 200
    assert response.json() == {"mode": "full"}
