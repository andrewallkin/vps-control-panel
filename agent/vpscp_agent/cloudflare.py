from __future__ import annotations

from typing import Any

import httpx

MANAGED_BY_COMMENT = "managed-by=vpscp"
_DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4"
_PER_PAGE = 50


class CloudflareError(Exception):
    pass


class CloudflareClient:
    def __init__(
        self,
        token: str,
        base_url: str = _DEFAULT_BASE_URL,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._token = token
        self._base_url = base_url.rstrip("/")
        self._transport = transport

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self._token}"},
            transport=self._transport,
        )

    def _parse_body(self, response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError as exc:
            raise CloudflareError(
                f"invalid Cloudflare response: HTTP {response.status_code}"
            ) from exc
        if not isinstance(body, dict):
            raise CloudflareError("invalid Cloudflare response body")
        return body

    def _error_message(self, body: dict[str, Any]) -> str:
        errors = body.get("errors")
        if isinstance(errors, list) and errors:
            first = errors[0]
            if isinstance(first, dict) and first.get("message"):
                return str(first["message"])
        return "Cloudflare API request failed"

    def _is_auth_error(self, body: dict[str, Any]) -> bool:
        errors = body.get("errors")
        if not isinstance(errors, list):
            return False
        for item in errors:
            if not isinstance(item, dict):
                continue
            code = item.get("code")
            message = str(item.get("message", "")).lower()
            if code in (9109, 10000, 10001, 10003):
                return True
            if "auth" in message or "unauthorized" in message or "permission" in message:
                return True
        return False

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        with self._client() as client:
            response = client.request(method, path, params=params, json=json)
        body = self._parse_body(response)
        if not body.get("success"):
            raise CloudflareError(self._error_message(body))
        return body.get("result")

    def _request_raw(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict | None = None,
    ) -> httpx.Response:
        with self._client() as client:
            return client.request(method, path, params=params, json=json)

    def _paginated_list(self, path: str, *, params: dict[str, Any] | None = None) -> list[Any]:
        page = 1
        items: list[Any] = []
        base_params = dict(params or {})
        while True:
            with self._client() as client:
                response = client.get(
                    path,
                    params={**base_params, "per_page": _PER_PAGE, "page": page},
                )
            body = self._parse_body(response)
            if not body.get("success"):
                raise CloudflareError(self._error_message(body))
            batch = body.get("result")
            if isinstance(batch, list):
                items.extend(batch)
            result_info = body.get("result_info") or {}
            total_pages = int(result_info.get("total_pages") or page)
            if page >= total_pages:
                break
            page += 1
        return items

    def verify(self) -> None:
        result = self._request("GET", "/user/tokens/verify")
        if not isinstance(result, dict) or result.get("status") != "active":
            raise CloudflareError("Cloudflare API token is not active")

    def list_zones(self) -> list[dict[str, str]]:
        rows = self._paginated_list("/zones")
        zones: list[dict[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            zones.append(
                {
                    "id": str(row["id"]),
                    "name": str(row["name"]),
                    "status": str(row.get("status", "")),
                }
            )
        return zones

    def get_ssl_mode(self, zone_id: str) -> str | None:
        response = self._request_raw("GET", f"/zones/{zone_id}/settings/ssl")
        body = self._parse_body(response)
        if response.status_code == 403 or (not body.get("success") and self._is_auth_error(body)):
            return None
        if not body.get("success"):
            raise CloudflareError(self._error_message(body))
        result = body.get("result")
        if isinstance(result, dict) and result.get("value") is not None:
            return str(result["value"])
        return None

    def find_a_record(self, zone_id: str, fqdn: str) -> dict[str, Any] | None:
        page = 1
        while True:
            with self._client() as client:
                response = client.get(
                    f"/zones/{zone_id}/dns_records",
                    params={
                        "type": "A",
                        "name": fqdn,
                        "per_page": _PER_PAGE,
                        "page": page,
                    },
                )
            body = self._parse_body(response)
            if not body.get("success"):
                raise CloudflareError(self._error_message(body))
            batch = body.get("result")
            if isinstance(batch, list):
                for row in batch:
                    if isinstance(row, dict) and row.get("type") == "A":
                        return row
            result_info = body.get("result_info") or {}
            total_pages = int(result_info.get("total_pages") or page)
            if page >= total_pages:
                break
            page += 1
        return None

    def upsert_a_record(
        self,
        zone_id: str,
        fqdn: str,
        ip: str,
        *,
        proxied: bool = True,
    ) -> dict[str, Any]:
        payload = {
            "type": "A",
            "name": fqdn,
            "content": ip,
            "proxied": proxied,
            "comment": MANAGED_BY_COMMENT,
        }
        existing = self.find_a_record(zone_id, fqdn)
        if existing is None:
            result = self._request("POST", f"/zones/{zone_id}/dns_records", json=payload)
        else:
            record_id = existing["id"]
            result = self._request(
                "PATCH",
                f"/zones/{zone_id}/dns_records/{record_id}",
                json=payload,
            )
        if not isinstance(result, dict):
            raise CloudflareError("unexpected Cloudflare DNS response")
        return result

    def delete_a_record(self, zone_id: str, fqdn: str) -> None:
        existing = self.find_a_record(zone_id, fqdn)
        if existing is None:
            return
        if existing.get("comment") != MANAGED_BY_COMMENT:
            raise ValueError(
                f"refusing to delete DNS record without {MANAGED_BY_COMMENT!r} comment: {fqdn!r}"
            )
        record_id = existing["id"]
        self._request("DELETE", f"/zones/{zone_id}/dns_records/{record_id}")
