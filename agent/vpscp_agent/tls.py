from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from cryptography import x509
from cryptography.x509.oid import ExtensionOID

from vpscp_agent.commands import CommandResult
from vpscp_agent.config import Settings
from vpscp_agent.credentials import cloudflare_ini_path
from vpscp_agent.domains import list_domains
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_domain

if TYPE_CHECKING:
    from vpscp_agent.jobs import JobContext

_HOOK_REL = Path("renewal-hooks/deploy/vpscp-reload-nginx.sh")
_HOOK_CONTENT = "#!/bin/sh\nsystemctl reload nginx\n"


def cert_paths(settings: Settings, domain: str) -> dict[str, Path]:
    live = settings.letsencrypt_dir / "live" / domain
    return {
        "cert": live / "cert.pem",
        "chain": live / "chain.pem",
        "fullchain": live / "fullchain.pem",
        "privkey": live / "privkey.pem",
    }


def _deploy_hook_path(settings: Settings) -> Path:
    return settings.letsencrypt_dir / _HOOK_REL


def _ensure_deploy_hook(settings: Settings) -> None:
    path = _deploy_hook_path(settings)
    if path.is_file():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_HOOK_CONTENT)
    os.chmod(path, 0o755)


def _certbot_issue_argv(settings: Settings, domain: str, email: str) -> list[str]:
    ini = cloudflare_ini_path(settings)
    return [
        "certbot",
        "certonly",
        "--non-interactive",
        "--agree-tos",
        "-m",
        email,
        "--dns-cloudflare",
        "--dns-cloudflare-credentials",
        str(ini),
        "--dns-cloudflare-propagation-seconds",
        "30",
        "--cert-name",
        domain,
        "-d",
        domain,
        "-d",
        f"*.{domain}",
        "--key-type",
        "ecdsa",
    ]


def _log_command_output(ctx: JobContext, result: CommandResult) -> None:
    for line in result.stdout.splitlines():
        ctx.log(line)
    for line in result.stderr.splitlines():
        ctx.log(line)


def require_issue_preconditions(
    settings: Settings, db: StateDB, domain: str, email: str | None
) -> None:
    validate_domain(domain)
    if not email:
        raise ValueError("acme_email is not configured")
    registered = {record.name for record in list_domains(db)}
    if domain not in registered:
        raise ValueError(f"domain not registered: {domain!r}")
    if not cloudflare_ini_path(settings).is_file():
        raise ValueError("Cloudflare credentials are not configured")


def issue(
    ctx: JobContext,
    *,
    settings: Settings,
    runner,
    domain: str,
    email: str,
) -> None:
    _ensure_deploy_hook(settings)
    result = runner(_certbot_issue_argv(settings, domain, email))
    _log_command_output(ctx, result)


def renew_all(ctx: JobContext, *, settings: Settings, runner) -> None:
    result = runner(["certbot", "renew", "--no-random-sleep-on-renew"])
    _log_command_output(ctx, result)


def _parse_cert(fullchain: Path) -> tuple[str, int, list[str]]:
    pem = fullchain.read_bytes()
    cert = x509.load_pem_x509_certificate(pem)
    not_after_dt = cert.not_valid_after_utc
    not_after = not_after_dt.isoformat(timespec="seconds")
    days_left = (not_after_dt.date() - datetime.now(UTC).date()).days
    sans: list[str] = []
    try:
        san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
    except x509.ExtensionNotFound:
        return not_after, days_left, sans
    for name in san_ext.value:
        if isinstance(name, x509.DNSName):
            sans.append(name.value)
    sans.sort()
    return not_after, days_left, sans


def status(settings: Settings, db: StateDB) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in list_domains(db):
        domain = record.name
        fullchain = cert_paths(settings, domain)["fullchain"]
        if not fullchain.is_file():
            rows.append(
                {
                    "domain": domain,
                    "exists": False,
                    "not_after": None,
                    "days_left": None,
                    "sans": [],
                }
            )
            continue
        not_after, days_left, sans = _parse_cert(fullchain)
        rows.append(
            {
                "domain": domain,
                "exists": True,
                "not_after": not_after,
                "days_left": days_left,
                "sans": sans,
            }
        )
    return rows
