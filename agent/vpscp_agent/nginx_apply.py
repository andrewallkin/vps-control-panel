from __future__ import annotations

import os
import re
import urllib.request
from collections.abc import Callable
from pathlib import Path

from vpscp_agent.commands import CommandResult, Runner
from vpscp_agent.config import Settings
from vpscp_agent.hostnames import release_site
from vpscp_agent.nginx_render import render_cloudflare_realip, render_default_server
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_slug

PANEL_SITE_ID = "vpscp-panel"
_SSL_CERT_RE = re.compile(r"^\s*ssl_certificate\s+([^;\s]+)\s*;", re.MULTILINE)
_LIVE_DOMAIN_RE = re.compile(r"/live/([^/]+)/")
CF_IPV4_URL = "https://www.cloudflare.com/ips-v4"
CF_IPV6_URL = "https://www.cloudflare.com/ips-v6"
SETTING_CF_IPV4 = "cloudflare_ips_v4"
SETTING_CF_IPV6 = "cloudflare_ips_v6"

CloudflareIpFetcher = Callable[[], tuple[list[str], list[str]]]


class NginxTestError(Exception):
    def __init__(self, output: str) -> None:
        self.output = output
        super().__init__(output)


def validate_site_id(site_id: str) -> str:
    if site_id == PANEL_SITE_ID:
        return site_id
    return validate_slug(site_id)


def site_conf_path(nginx_dir: Path, site_id: str) -> Path:
    validate_site_id(site_id)
    return nginx_dir / "sites-available" / f"vpscp-{site_id}.conf"


def site_enabled_path(nginx_dir: Path, site_id: str) -> Path:
    validate_site_id(site_id)
    return nginx_dir / "sites-enabled" / f"vpscp-{site_id}.conf"


def verify_certificates(content: str) -> None:
    for match in _SSL_CERT_RE.finditer(content):
        cert_path = Path(match.group(1))
        if cert_path.is_file():
            continue
        live = _LIVE_DOMAIN_RE.search(str(cert_path))
        domain = live.group(1) if live is not None else cert_path.name
        raise ValueError(f"certificate for {domain} not issued")


def _nginx_test_output(result: CommandResult) -> str:
    parts = [result.stderr.strip(), result.stdout.strip()]
    return "\n".join(part for part in parts if part)


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    os.replace(tmp_path, path)


def _ensure_symlink(link: Path, target: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(target.resolve())


class _PathSnapshot:
    __slots__ = ("content", "existed", "link_target")

    def __init__(
        self,
        *,
        existed: bool,
        content: bytes | None = None,
        link_target: Path | None = None,
    ) -> None:
        self.existed = existed
        self.content = content
        self.link_target = link_target


def _snapshot_path(path: Path) -> _PathSnapshot:
    if path.is_symlink():
        return _PathSnapshot(existed=True, link_target=Path(os.readlink(path)))
    if path.is_file():
        return _PathSnapshot(existed=True, content=path.read_bytes())
    return _PathSnapshot(existed=False)


def _restore_path(path: Path, snapshot: _PathSnapshot) -> None:
    path.unlink(missing_ok=True)
    if not snapshot.existed:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if snapshot.link_target is not None:
        path.symlink_to(snapshot.link_target)
    elif snapshot.content is not None:
        path.write_bytes(snapshot.content)


def _restore_site_config(
    *,
    conf_path: Path,
    enabled_path: Path,
    prev_path: Path,
    had_previous: bool,
) -> None:
    enabled_path.unlink(missing_ok=True)
    conf_path.unlink(missing_ok=True)
    if had_previous and prev_path.is_file():
        prev_bytes = prev_path.read_bytes()
        conf_path.write_bytes(prev_bytes)
        _ensure_symlink(enabled_path, conf_path)


def apply_site(
    site_id: str,
    content: str,
    *,
    settings: Settings,
    runner: Runner,
) -> None:
    validate_site_id(site_id)
    verify_certificates(content)

    nginx_dir = settings.nginx_dir
    conf_path = site_conf_path(nginx_dir, site_id)
    enabled_path = site_enabled_path(nginx_dir, site_id)
    prev_path = conf_path.with_name(conf_path.name + ".vpscp-prev")
    temp_path = conf_path.parent / f".{conf_path.name}.tmp.{os.getpid()}"

    had_previous = conf_path.is_file()
    try:
        _write_atomic(temp_path, content)
        if had_previous:
            if prev_path.exists():
                prev_path.unlink()
            conf_path.replace(prev_path)
        os.replace(temp_path, conf_path)
        try:
            _ensure_symlink(enabled_path, conf_path)

            result = runner(["nginx", "-t"], check=False)
            if result.returncode != 0:
                raise NginxTestError(_nginx_test_output(result))

            runner(["systemctl", "reload", "nginx"])
            prev_path.unlink(missing_ok=True)
        except Exception:
            _restore_site_config(
                conf_path=conf_path,
                enabled_path=enabled_path,
                prev_path=prev_path,
                had_previous=had_previous,
            )
            raise
    finally:
        temp_path.unlink(missing_ok=True)


def remove_site(
    site_id: str,
    *,
    settings: Settings,
    runner: Runner,
    db: StateDB,
) -> None:
    validate_site_id(site_id)

    nginx_dir = settings.nginx_dir
    conf_path = site_conf_path(nginx_dir, site_id)
    enabled_path = site_enabled_path(nginx_dir, site_id)

    if not conf_path.is_file() and not enabled_path.exists():
        release_site(db, site_id)
        return

    saved_conf: bytes | None = conf_path.read_bytes() if conf_path.is_file() else None
    saved_link_target: Path | None = None
    if enabled_path.is_symlink():
        saved_link_target = Path(os.readlink(enabled_path))

    enabled_path.unlink(missing_ok=True)
    conf_path.unlink(missing_ok=True)

    result = runner(["nginx", "-t"], check=False)
    if result.returncode != 0:
        if saved_conf is not None:
            conf_path.write_bytes(saved_conf)
        if saved_link_target is not None:
            _ensure_symlink(enabled_path, saved_link_target)
        elif saved_conf is not None:
            _ensure_symlink(enabled_path, conf_path)
        raise NginxTestError(_nginx_test_output(result))

    runner(["systemctl", "reload", "nginx"])
    release_site(db, site_id)


def _get_setting(db: StateDB, key: str) -> str | None:
    with db.connect() as conn:
        row = conn.execute("SELECT value FROM agent_setting WHERE key = ?", (key,)).fetchone()
    return None if row is None else row["value"]


def _set_setting(db: StateDB, key: str, value: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agent_setting (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def _parse_cidr_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def default_fetch_cloudflare_ips() -> tuple[list[str], list[str]]:
    with urllib.request.urlopen(CF_IPV4_URL, timeout=30) as response:
        ipv4 = _parse_cidr_lines(response.read().decode())
    with urllib.request.urlopen(CF_IPV6_URL, timeout=30) as response:
        ipv6 = _parse_cidr_lines(response.read().decode())
    return ipv4, ipv6


def fetch_cloudflare_ips_cached(
    db: StateDB,
    *,
    fetch: CloudflareIpFetcher | None = None,
    force: bool = False,
) -> tuple[list[str], list[str]]:
    if not force:
        cached_v4 = _get_setting(db, SETTING_CF_IPV4)
        cached_v6 = _get_setting(db, SETTING_CF_IPV6)
        if cached_v4 is not None and cached_v6 is not None:
            return _parse_cidr_lines(cached_v4), _parse_cidr_lines(cached_v6)

    fetch_fn = fetch if fetch is not None else default_fetch_cloudflare_ips
    ipv4, ipv6 = fetch_fn()
    _set_setting(db, SETTING_CF_IPV4, "\n".join(ipv4))
    _set_setting(db, SETTING_CF_IPV6, "\n".join(ipv6))
    return ipv4, ipv6


def ensure_base_config(
    *,
    settings: Settings,
    runner: Runner,
    db: StateDB,
    fetch: CloudflareIpFetcher | None = None,
    force_fetch: bool = False,
) -> None:
    ipv4, ipv6 = fetch_cloudflare_ips_cached(db, fetch=fetch, force=force_fetch)

    nginx_dir = settings.nginx_dir
    realip_path = nginx_dir / "conf.d" / "vpscp-realip.conf"
    default_available = nginx_dir / "sites-available" / "vpscp-default.conf"
    default_enabled = nginx_dir / "sites-enabled" / "vpscp-default.conf"
    stock_default = nginx_dir / "sites-enabled" / "default"

    realip_prev = _snapshot_path(realip_path)
    default_avail_prev = _snapshot_path(default_available)
    default_enabled_prev = _snapshot_path(default_enabled)
    stock_default_prev = _snapshot_path(stock_default)

    _write_atomic(realip_path, render_cloudflare_realip(ipv4, ipv6))
    _write_atomic(default_available, render_default_server())
    _ensure_symlink(default_enabled, default_available)
    stock_default.unlink(missing_ok=True)

    result = runner(["nginx", "-t"], check=False)
    if result.returncode != 0:
        _restore_path(realip_path, realip_prev)
        _restore_path(default_available, default_avail_prev)
        _restore_path(default_enabled, default_enabled_prev)
        _restore_path(stock_default, stock_default_prev)
        raise NginxTestError(_nginx_test_output(result))
    runner(["systemctl", "reload", "nginx"])


def list_nginx_sites(db: StateDB) -> list[dict[str, list[str] | str]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT site, fqdn FROM hostname ORDER BY site, fqdn",
        ).fetchall()
    by_site: dict[str, list[str]] = {}
    for row in rows:
        by_site.setdefault(row["site"], []).append(row["fqdn"])
    return [
        {"site_id": site, "hostnames": hostnames} for site, hostnames in sorted(by_site.items())
    ]
