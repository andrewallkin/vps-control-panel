import json

import httpx
import pytest

from vpscp_agent.cloudflare import (
    MANAGED_BY_COMMENT,
    CloudflareClient,
    CloudflareError,
    SslModeResult,
)
from vpscp_agent.config import load_settings
from vpscp_agent.credentials import read_cloudflare_token, write_cloudflare_ini


def test_list_zones_pagination():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.path.endswith("/zones"):
            page = int(request.url.params.get("page", "1"))
            if page == 1:
                return httpx.Response(
                    200,
                    json={
                        "success": True,
                        "result": [{"id": "z1", "name": "a.com", "status": "active"}],
                        "result_info": {"page": 1, "total_pages": 2},
                    },
                )
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [{"id": "z2", "name": "b.com", "status": "pending"}],
                    "result_info": {"page": 2, "total_pages": 2},
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    zones = client.list_zones()
    assert zones == [
        {"id": "z1", "name": "a.com", "status": "active"},
        {"id": "z2", "name": "b.com", "status": "pending"},
    ]
    assert len(calls) == 2
    assert "page=1" in calls[0]
    assert "per_page=50" in calls[0]


def test_verify_requires_active_token():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"success": True, "result": {"status": "expired"}},
        )

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    with pytest.raises(CloudflareError, match="active"):
        client.verify()


def test_cloudflare_error_uses_first_message():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "success": False,
                "errors": [{"message": "first error"}, {"message": "second"}],
            },
        )

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    with pytest.raises(CloudflareError, match="first error"):
        client.list_zones()


def test_get_ssl_mode_returns_null_on_permission_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/settings/ssl"):
            return httpx.Response(
                403,
                json={
                    "success": False,
                    "errors": [{"code": 9109, "message": "Unauthorized to access this resource"}],
                },
            )
        raise AssertionError(request.url.path)

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    assert client.get_ssl_mode("zone-1") == SslModeResult(mode=None, error="permission")


def test_get_ssl_mode_returns_value():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/settings/ssl"):
            return httpx.Response(
                200,
                json={"success": True, "result": {"id": "ssl", "value": "strict"}},
            )
        raise AssertionError(request.url.path)

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    assert client.get_ssl_mode("zone-1") == SslModeResult(mode="strict", error=None)


def test_upsert_a_record_create():
    seen: list[tuple[str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dns_records") and request.method == "GET":
            return httpx.Response(200, json={"success": True, "result": []})
        if request.url.path.endswith("/dns_records") and request.method == "POST":
            body = json.loads(request.content.decode())
            seen.append(("POST", body))
            return httpx.Response(
                200,
                json={"success": True, "result": {"id": "rec-new", **body}},
            )
        raise AssertionError(f"{request.method} {request.url}")

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    out = client.upsert_a_record("zone-1", "app.example.com", "203.0.113.1")
    assert out["id"] == "rec-new"
    assert seen == [
        (
            "POST",
            {
                "type": "A",
                "name": "app.example.com",
                "content": "203.0.113.1",
                "proxied": True,
                "comment": MANAGED_BY_COMMENT,
            },
        )
    ]


def test_upsert_a_record_update_existing():
    seen: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dns_records") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [
                        {
                            "id": "rec-1",
                            "type": "A",
                            "name": "app.example.com",
                            "content": "198.51.100.1",
                            "proxied": True,
                            "comment": MANAGED_BY_COMMENT,
                        }
                    ],
                },
            )
        if "/dns_records/rec-1" in request.url.path and request.method == "PATCH":
            body = json.loads(request.content.decode())
            seen.append(("PATCH", "rec-1", body))
            return httpx.Response(200, json={"success": True, "result": {"id": "rec-1", **body}})
        raise AssertionError(f"{request.method} {request.url}")

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    client.upsert_a_record("zone-1", "app.example.com", "203.0.113.1")
    assert seen == [
        (
            "PATCH",
            "rec-1",
            {
                "type": "A",
                "name": "app.example.com",
                "content": "203.0.113.1",
                "proxied": True,
                "comment": MANAGED_BY_COMMENT,
            },
        )
    ]


def test_find_a_record_pagination():
    def handler(request: httpx.Request) -> httpx.Response:
        if not request.url.path.endswith("/dns_records"):
            raise AssertionError(request.url.path)
        page = int(request.url.params.get("page", "1"))
        if page == 1:
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "result": [],
                    "result_info": {"page": 1, "total_pages": 2},
                },
            )
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
                        "comment": MANAGED_BY_COMMENT,
                    }
                ],
                "result_info": {"page": 2, "total_pages": 2},
            },
        )

    client = CloudflareClient("tok", transport=httpx.MockTransport(handler))
    record = client.find_a_record("zone-1", "app.example.com")
    assert record is not None
    assert record["id"] == "rec-1"


def test_write_and_read_cloudflare_ini(tmp_path):
    settings = load_settings({"VPSCP_STATE_DIR": str(tmp_path)})
    write_cloudflare_ini(settings, "cf-secret-token")
    path = tmp_path / "cloudflare.ini"
    assert path.read_text() == "dns_cloudflare_api_token = cf-secret-token\n"
    assert (path.stat().st_mode & 0o777) == 0o600
    assert read_cloudflare_token(settings) == "cf-secret-token"
