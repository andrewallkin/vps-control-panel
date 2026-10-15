import json

import httpx
import pytest
from fastapi.testclient import TestClient

from vpscp_agent import audit
from vpscp_agent.config import load_settings
from vpscp_agent.credentials import write_cloudflare_ini
from vpscp_agent.main import create_app

PHASE = "/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint"


@pytest.fixture
def rules_client(tmp_path):
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
    write_cloudflare_ini(settings, "cf-token")
    transport_holder: dict[str, httpx.MockTransport] = {}

    def factory(token: str, transport=None):
        from vpscp_agent.cloudflare import CloudflareClient

        return CloudflareClient(token, transport=transport_holder["transport"])

    with TestClient(create_app(settings)) as client:
        client.app.state.cloudflare_client_factory = factory
        client.post("/v1/domains", json={"name": "example.com", "zone_id": "zone-1"})
        yield client, transport_holder


def _body(**overrides):
    payload = {
        "domain": "example.com",
        "name": "Allow webhooks",
        "description": "Strava and Telegram",
        "expression": 'http.request.uri.path eq "/api/strava/webhook"',
        "action": "skip",
        "enabled": True,
        "logging": True,
        "skip": ["ruleset_current", "managed_rules"],
        "placement": {"kind": "first"},
    }
    payload.update(overrides)
    return payload


def test_create_rule_on_missing_entrypoint_and_list(rules_client):
    client, holder = rules_client
    created = {"ruleset": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/entrypoint"):
            if not created["ruleset"]:
                return httpx.Response(
                    404,
                    json={"success": False, "errors": [{"message": "not found"}]},
                )
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "id": "rs-1",
                        "rules": [
                            {
                                "id": "rule-1",
                                "description": "Allow webhooks\n\nStrava and Telegram",
                                "expression": 'http.request.uri.path eq "/api/strava/webhook"',
                                "action": "skip",
                                "enabled": True,
                                "logging": {"enabled": True},
                                "action_parameters": {
                                    "ruleset": "current",
                                    "phases": ["http_request_firewall_managed"],
                                },
                            }
                        ],
                    },
                },
            )
        if request.method == "POST" and request.url.path.endswith("/rulesets"):
            body = json.loads(request.content)
            assert body["phase"] == "http_request_firewall_custom"
            assert body["rules"][0]["description"] == "Allow webhooks\n\nStrava and Telegram"
            assert body["rules"][0]["action_parameters"]["ruleset"] == "current"
            assert "position" not in body["rules"][0]
            created["ruleset"] = True
            rule = {**body["rules"][0], "id": "rule-1"}
            return httpx.Response(
                200,
                json={"success": True, "result": {"id": "rs-1", "rules": [rule]}},
            )
        raise AssertionError(f"{request.method} {request.url.path}")

    holder["transport"] = httpx.MockTransport(handler)
    response = client.post("/v1/cloudflare/rules", json=_body())
    assert response.status_code == 200
    assert response.json()["name"] == "Allow webhooks"
    assert response.json()["description"] == "Strava and Telegram"
    assert response.json()["skip"] == ["ruleset_current", "managed_rules"]

    listed = client.get("/v1/cloudflare/rules", params={"domain": "example.com"})
    assert listed.status_code == 200
    assert listed.json()["error"] is None
    assert listed.json()["rules"][0]["id"] == "rule-1"
    events = audit.list_events(client.app.state.db)
    assert events[0].operation == "cloudflare.rule.create"


def test_update_rule_uses_patch_and_returns_rule(rules_client):
    client, holder = rules_client

    def handler(request: httpx.Request) -> httpx.Response:
        method, path = request.method, request.url.path
        if method == "GET" and path.endswith("/entrypoint"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": {
                        "id": "rs-1",
                        "rules": [
                            {
                                "id": "rule-1",
                                "description": "Allow webhooks\n\nStrava and Telegram",
                                "expression": 'http.request.uri.path eq "/api/strava/webhook"',
                                "action": "skip",
                                "enabled": True,
                                "logging": {"enabled": True},
                                "action_parameters": {"ruleset": "current"},
                            }
                        ],
                    },
                },
            )
        if method == "PATCH" and "/rulesets/rs-1/rules/rule-1" in path:
            body = json.loads(request.content)
            assert body["action"] == "managed_challenge"
            assert "action_parameters" not in body
            updated = {
                "id": "rule-1",
                "description": "Challenge bots\n\nsuspicious paths",
                "expression": body["expression"],
                "action": "managed_challenge",
                "enabled": True,
            }
            return httpx.Response(
                200,
                json={"success": True, "result": {"id": "rs-1", "rules": [updated]}},
            )
        raise AssertionError(f"{method} {path}")

    holder["transport"] = httpx.MockTransport(handler)
    response = client.put(
        "/v1/cloudflare/rules/rule-1",
        params={"domain": "example.com"},
        json=_body(
            name="Challenge bots",
            description="suspicious paths",
            action="managed_challenge",
            skip=[],
        ),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "rule-1"
    assert payload["action"] == "managed_challenge"
    assert payload["name"] == "Challenge bots"
    assert payload["description"] == "suspicious paths"
    assert payload["skip"] == []
    events = audit.list_events(client.app.state.db)
    assert events[0].operation == "cloudflare.rule.update"


def test_list_permission_is_not_an_empty_zone(rules_client):
    client, holder = rules_client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]},
        )

    holder["transport"] = httpx.MockTransport(handler)
    response = client.get("/v1/cloudflare/rules", params={"domain": "example.com"})
    assert response.status_code == 200
    assert response.json() == {"rules": [], "error": "permission"}


def test_delete_missing_rule(rules_client):
    client, holder = rules_client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"success": True, "result": {"id": "rs-1", "rules": []}},
        )

    holder["transport"] = httpx.MockTransport(handler)
    response = client.delete("/v1/cloudflare/rules/rule-9", params={"domain": "example.com"})
    assert response.status_code == 404
