import json
from datetime import timedelta

import httpx
import pytest
from conftest import login, totp_code

import vpscp_panel.db as db_module
from vpscp_panel.models import Domain


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
def rules_state():
    return {"rules": []}


@pytest.fixture
def rules_client(client_factory, admin_user, rules_state):
    with db_module.SessionLocal() as db:
        db.add(
            Domain(
                name="example.com",
                zone_id="zone-1",
                cert_status=None,
                cert_expires_at=None,
            )
        )
        db.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/cloudflare/rules" and request.method == "GET":
            assert request.url.params["domain"] == "example.com"
            return httpx.Response(200, json={"rules": rules_state["rules"], "error": None})
        if request.url.path == "/v1/cloudflare/rules" and request.method == "POST":
            body = json.loads(request.content)
            rule = {"id": "rule-1", **{key: body[key] for key in body if key != "domain"}}
            rule.pop("placement", None)
            rules_state["rules"] = [rule]
            return httpx.Response(200, json=rule)
        return httpx.Response(404, json={"detail": "not found"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        yield client


def test_list_and_create_rules(rules_client, admin_user, frozen_time):
    auth = login(rules_client, admin_user, frozen_time)
    listed = rules_client.get("/api/cloudflare/rules", params={"domain": "example.com"})
    assert listed.status_code == 200
    assert listed.json() == {"rules": [], "error": None}

    body = {
        "domain": "example.com",
        "name": "Allow webhooks",
        "description": "",
        "expression": "true",
        "action": "block",
        "enabled": True,
        "logging": False,
        "skip": [],
        "placement": {"kind": "last"},
    }
    denied = rules_client.post("/api/cloudflare/rules", json=body, headers=csrf_headers(auth))
    assert denied.status_code == 403
    assert denied.json()["detail"] == "step_up_required"

    stepped = step_up(rules_client, auth, admin_user, frozen_time + timedelta(seconds=31))
    assert stepped.status_code == 200
    created = rules_client.post("/api/cloudflare/rules", json=body, headers=csrf_headers(auth))
    assert created.status_code == 200
    assert created.json()["name"] == "Allow webhooks"


def test_unknown_domain_is_not_forwarded(rules_client, admin_user, frozen_time):
    login(rules_client, admin_user, frozen_time)
    response = rules_client.get("/api/cloudflare/rules", params={"domain": "other.example"})
    assert response.status_code == 404
