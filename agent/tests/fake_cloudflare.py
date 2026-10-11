"""Minimal fake Cloudflare API v4 for local and Multipass testing.

Run: ``python agent/tests/fake_cloudflare.py`` (optional port argument, default 8787).
"""

from __future__ import annotations

import json
import re
import sys
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

MANAGED_BY_COMMENT = "managed-by=vpscp"
_API_PREFIX = "/client/v4"

_DEFAULT_ZONES: list[dict[str, str]] = [
    {"id": "zone-example-test", "name": "example.test", "status": "active"},
]

_records: dict[str, list[dict[str, Any]]] = {}
_ssl_mode = "full"


def _json_response(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    parsed = json.loads(raw.decode())
    if not isinstance(parsed, dict):
        raise TypeError("expected JSON object")
    return parsed


class FakeCloudflareHandler(BaseHTTPRequestHandler):
    server_version = "FakeCloudflare/1.0"

    def log_message(self, format: str, *args: object) -> None:
        message = format % args
        sys.stderr.write(f"{self.address_string()} - - [{self.log_date_time_string()}] {message}\n")

    def _api_path_and_query(self) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith(_API_PREFIX):
            path = path[len(_API_PREFIX) :] or "/"
        return path, parse_qs(parsed.query)

    def do_GET(self) -> None:
        path, query = self._api_path_and_query()

        if path == "/user/tokens/verify":
            _json_response(
                self,
                200,
                {"success": True, "result": {"status": "active"}},
            )
            return

        if path == "/zones":
            page = int(query.get("page", ["1"])[0])
            per_page = int(query.get("per_page", ["50"])[0])
            zones = _DEFAULT_ZONES
            start = (page - 1) * per_page
            batch = zones[start : start + per_page]
            total_pages = max(1, (len(zones) + per_page - 1) // per_page)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "result": batch,
                    "result_info": {"page": page, "total_pages": total_pages},
                },
            )
            return

        ssl_match = re.fullmatch(r"/zones/([^/]+)/settings/ssl", path)
        if ssl_match:
            _json_response(
                self,
                200,
                {"success": True, "result": {"id": "ssl", "value": _ssl_mode}},
            )
            return

        dns_list = re.fullmatch(r"/zones/([^/]+)/dns_records", path)
        if dns_list:
            zone_id = dns_list.group(1)
            name_filter = query.get("name", [None])[0]
            page = int(query.get("page", ["1"])[0])
            records = _records.get(zone_id, [])
            if name_filter is not None:
                records = [r for r in records if r.get("name") == name_filter]
            per_page = int(query.get("per_page", ["50"])[0])
            start = (page - 1) * per_page
            batch = records[start : start + per_page]
            total_pages = max(1, (len(records) + per_page - 1) // per_page)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "result": batch,
                    "result_info": {"page": page, "total_pages": total_pages},
                },
            )
            return

        _json_response(
            self,
            404,
            {"success": False, "errors": [{"message": f"unknown GET {path}"}]},
        )

    def do_POST(self) -> None:
        path, _query = self._api_path_and_query()
        dns_create = re.fullmatch(r"/zones/([^/]+)/dns_records", path)
        if dns_create:
            zone_id = dns_create.group(1)
            body = _read_json(self)
            record_id = f"rec-{uuid.uuid4().hex[:12]}"
            record = {
                "id": record_id,
                "type": body.get("type", "A"),
                "name": body["name"],
                "content": body["content"],
                "proxied": body.get("proxied", True),
                "comment": body.get("comment", MANAGED_BY_COMMENT),
            }
            _records.setdefault(zone_id, []).append(record)
            _json_response(self, 200, {"success": True, "result": record})
            return

        _json_response(
            self,
            404,
            {"success": False, "errors": [{"message": f"unknown POST {path}"}]},
        )

    def do_PATCH(self) -> None:
        path, _query = self._api_path_and_query()
        dns_patch = re.fullmatch(r"/zones/([^/]+)/dns_records/([^/]+)", path)
        if dns_patch:
            zone_id, record_id = dns_patch.group(1), dns_patch.group(2)
            body = _read_json(self)
            for record in _records.get(zone_id, []):
                if record["id"] == record_id:
                    record.update(body)
                    _json_response(self, 200, {"success": True, "result": record})
                    return
            _json_response(
                self,
                404,
                {"success": False, "errors": [{"message": "record not found"}]},
            )
            return

        _json_response(
            self,
            404,
            {"success": False, "errors": [{"message": f"unknown PATCH {path}"}]},
        )

    def do_DELETE(self) -> None:
        path, _query = self._api_path_and_query()
        dns_delete = re.fullmatch(r"/zones/([^/]+)/dns_records/([^/]+)", path)
        if dns_delete:
            zone_id, record_id = dns_delete.group(1), dns_delete.group(2)
            zone_records = _records.get(zone_id, [])
            _records[zone_id] = [r for r in zone_records if r["id"] != record_id]
            _json_response(self, 200, {"success": True, "result": {"id": record_id}})
            return

        _json_response(
            self,
            404,
            {"success": False, "errors": [{"message": f"unknown DELETE {path}"}]},
        )


def main() -> None:
    host = "127.0.0.1"
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    server = HTTPServer((host, port), FakeCloudflareHandler)
    print(f"fake Cloudflare API listening on http://{host}:{port}/client/v4", flush=True)
    print(
        f"Set VPSCP_CLOUDFLARE_API=http://127.0.0.1:{port}/client/v4",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
