import os
from pathlib import Path

import pytest

from vpscp_agent.nginx_render import (
    HostnameSpec,
    RouteSpec,
    SiteSpec,
    render_cloudflare_realip,
    render_default_server,
    render_site,
)

GOLDEN_DIR = Path(__file__).parent / "golden"


def _read_golden(name: str) -> str:
    return (GOLDEN_DIR / name).read_text()


def _maybe_update_golden(name: str, rendered: str) -> None:
    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        (GOLDEN_DIR / name).write_text(rendered)


def _assert_matches_golden(name: str, rendered: str) -> None:
    _maybe_update_golden(name, rendered)
    assert rendered == _read_golden(name)


def test_golden_spa():
    spec = SiteSpec(
        site_id="budget",
        hostnames=[
            HostnameSpec(fqdn="budget.example.com", domain="example.com", kind="primary"),
        ],
        routes=[RouteSpec(path="/", port=10000)],
    )
    _assert_matches_golden("spa.conf", render_site(spec))


def test_golden_strava():
    spec = SiteSpec(
        site_id="strava",
        hostnames=[
            HostnameSpec(fqdn="strava.example.com", domain="example.com", kind="primary"),
        ],
        routes=[
            RouteSpec(path="/", port=10001),
            RouteSpec(path="/api/", port=10002, pass_authorization=True),
            RouteSpec(
                path="/mcp/",
                port=10003,
                streaming=True,
                read_timeout_s=3600,
            ),
        ],
    )
    _assert_matches_golden("strava.conf", render_site(spec))


def test_golden_root_www():
    spec = SiteSpec(
        site_id="personal",
        hostnames=[
            HostnameSpec(fqdn="example.org", domain="example.org", kind="primary"),
            HostnameSpec(fqdn="www.example.org", domain="example.org", kind="redirect"),
        ],
        routes=[RouteSpec(path="/", port=10004)],
    )
    _assert_matches_golden("root_www.conf", render_site(spec))


def test_golden_panel():
    spec = SiteSpec(
        site_id="vpscp-panel",
        panel=True,
        hostnames=[
            HostnameSpec(fqdn="panel.example.com", domain="example.com", kind="primary"),
        ],
        routes=[
            RouteSpec(path="/", port=8080, max_body_mb=32, read_timeout_s=3600),
        ],
    )
    _assert_matches_golden("panel.conf", render_site(spec))


def test_site_spec_requires_exactly_one_primary():
    with pytest.raises(ValueError, match="exactly one primary"):
        SiteSpec(
            site_id="budget",
            hostnames=[
                HostnameSpec(fqdn="a.example.com", domain="example.com", kind="alias"),
            ],
            routes=[RouteSpec(path="/", port=10000)],
        )


def test_site_spec_requires_unique_route_paths():
    with pytest.raises(ValueError, match="unique"):
        SiteSpec(
            site_id="budget",
            hostnames=[
                HostnameSpec(fqdn="budget.example.com", domain="example.com", kind="primary"),
            ],
            routes=[
                RouteSpec(path="/", port=10000),
                RouteSpec(path="/", port=10001),
            ],
        )


def test_redirect_hostnames_on_80_and_443():
    spec = SiteSpec(
        site_id="personal",
        hostnames=[
            HostnameSpec(fqdn="example.org", domain="example.org", kind="primary"),
            HostnameSpec(fqdn="www.example.org", domain="example.org", kind="redirect"),
        ],
        routes=[RouteSpec(path="/", port=10004)],
    )
    text = render_site(spec)
    assert "server_name www.example.org;" in text
    assert "return 301 https://example.org$request_uri;" in text


def test_routes_sorted_longest_path_first():
    spec = SiteSpec(
        site_id="strava",
        hostnames=[
            HostnameSpec(fqdn="strava.example.com", domain="example.com", kind="primary"),
        ],
        routes=[
            RouteSpec(path="/", port=10001),
            RouteSpec(path="/api/", port=10002),
            RouteSpec(path="/mcp/", port=10003, streaming=True, read_timeout_s=3600),
        ],
    )
    text = render_site(spec)
    mcp = text.index("location /mcp/")
    api = text.index("location /api/")
    root = text.index("\n    location / {\n")
    assert mcp < api < root


def test_render_cloudflare_realip():
    text = render_cloudflare_realip(["203.0.113.0/24"], ["2001:db8::/32"])
    assert "set_real_ip_from 203.0.113.0/24;" in text
    assert "set_real_ip_from 2001:db8::/32;" in text
    assert "real_ip_header CF-Connecting-IP;" in text
    assert "real_ip_recursive on;" in text


def test_render_default_server():
    text = render_default_server()
    assert "listen 80 default_server;" in text
    assert "return 444;" in text
    assert "listen 443 ssl default_server;" in text
    assert "ssl_reject_handshake on;" in text


def test_route_spec_accepts_port_8080():
    route = RouteSpec(path="/", port=8080)
    assert route.port == 8080


def test_render_does_not_touch_filesystem(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    spec = SiteSpec(
        site_id="budget",
        hostnames=[
            HostnameSpec(fqdn="budget.example.com", domain="example.com", kind="primary"),
        ],
        routes=[RouteSpec(path="/", port=10000)],
    )
    render_site(spec)
    assert list(tmp_path.iterdir()) == []
