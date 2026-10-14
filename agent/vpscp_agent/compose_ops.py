from __future__ import annotations

import json
import re
import shlex
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from vpscp_agent.commands import CommandError, Runner
from vpscp_agent.config import Settings
from vpscp_agent.db_ops import NotFoundError
from vpscp_agent.jobs import JobContext
from vpscp_agent.projects import get_project_row
from vpscp_agent.state import StateDB
from vpscp_agent.validation import safe_project_path, validate_project_slug

SERVICE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$")
IMAGE_VAR_RE = re.compile(r"\$\{(DOCKER_IMAGE_[A-Z0-9_]+)(:-[^}]*)?\}")
SERVICE_HEADER_RE = re.compile(r"^[ ]{2}[A-Za-z0-9_-]+:")

POSTGRES_NET_WARNING = "compose file does not join postgres-net"


def validate_compose_service_name(name: str) -> str:
    if not SERVICE_NAME_RE.fullmatch(name):
        raise ValueError(f"invalid service name: {name!r}")
    return name


def compose_project_cwd(settings: Settings, slug: str) -> Path:
    validate_project_slug(slug)
    return safe_project_path(settings.apps_dir, slug)


def compose_base_argv(slug: str, compose_file: str) -> list[str]:
    return [
        "docker",
        "compose",
        "-p",
        slug,
        "-f",
        compose_file,
        "--env-file",
        ".env",
    ]


def require_compose_project(settings: Settings, db: StateDB, slug: str) -> tuple[Any, Path, str]:
    validate_project_slug(slug)
    row = get_project_row(db, slug)
    if row is None:
        raise NotFoundError(f"project not found: {slug!r}")
    compose_file = row["compose_file"]
    project_dir = compose_project_cwd(settings, slug)
    resolved = safe_project_path(settings.apps_dir, slug, compose_file)
    if not resolved.is_file():
        raise ValueError(f"compose file not found: {compose_file!r}")
    return row, project_dir, compose_file


def run_compose_job(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    slug: str,
    extra_args: list[str],
    *,
    ctx: JobContext | None = None,
) -> None:
    _row, project_dir, compose_file = require_compose_project(settings, db, slug)
    args = compose_base_argv(slug, compose_file) + list(extra_args)
    if ctx is not None:
        ctx.log(" ".join(args))
    result = runner(args, cwd=project_dir, check=False, timeout=600)
    if ctx is not None and result.stdout:
        for line in result.stdout.splitlines():
            ctx.log(line)
    if result.returncode != 0:
        raise CommandError(result)


def compose_job_body(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    slug: str,
    extra_args: list[str],
):
    def body(ctx: JobContext) -> None:
        run_compose_job(settings, db, runner, slug, extra_args, ctx=ctx)

    return body


def migrate_argv(service: str, command: str) -> list[str]:
    validate_compose_service_name(service)
    stripped = command.strip()
    if not stripped:
        raise ValueError("command must not be empty")
    parts = shlex.split(stripped)
    if not parts:
        raise ValueError("command must not be empty")
    return ["run", "--rm", "--no-deps", service, *parts]


def _collect_networks(config: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    top = config.get("networks")
    if isinstance(top, dict):
        names.update(top.keys())
    services = config.get("services")
    if isinstance(services, dict):
        for svc in services.values():
            if not isinstance(svc, dict):
                continue
            nets = svc.get("networks")
            if isinstance(nets, list):
                for item in nets:
                    if isinstance(item, str):
                        names.add(item)
                    elif isinstance(item, dict) and "name" in item:
                        names.add(str(item["name"]))
            elif isinstance(nets, dict):
                names.update(nets.keys())
    return names


def _service_raw_slice(text: str, name: str) -> str:
    start_pat = re.compile(rf"^[ ]{{2}}{re.escape(name)}:")
    lines = text.splitlines()
    start_idx: int | None = None
    for idx, line in enumerate(lines):
        if start_pat.match(line):
            start_idx = idx
            break
    if start_idx is None:
        return ""
    end_idx = len(lines)
    for idx in range(start_idx + 1, len(lines)):
        line = lines[idx]
        if SERVICE_HEADER_RE.match(line):
            end_idx = idx
            break
        if line.strip():
            indent = len(line) - len(line.lstrip())
            if indent < 2:
                end_idx = idx
                break
    return "\n".join(lines[start_idx:end_idx])


def _image_var_from_slice(slice_text: str) -> str | None:
    match = IMAGE_VAR_RE.search(slice_text)
    if match is None:
        return None
    return match.group(1)


def get_compose_services(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    slug: str,
) -> dict[str, Any]:
    _row, project_dir, compose_file = require_compose_project(settings, db, slug)
    compose_path = safe_project_path(settings.apps_dir, slug, compose_file)
    raw_text = compose_path.read_text(encoding="utf-8")
    result = runner(
        compose_base_argv(slug, compose_file) + ["config", "--format", "json"],
        cwd=project_dir,
        check=True,
        timeout=120,
    )
    config = json.loads(result.stdout)
    network_names = sorted(_collect_networks(config))
    warning = None if "postgres-net" in network_names else POSTGRES_NET_WARNING
    services_out: list[dict[str, Any]] = []
    services_cfg = config.get("services")
    if isinstance(services_cfg, dict):
        for name in sorted(services_cfg.keys()):
            svc = services_cfg[name]
            image = ""
            if isinstance(svc, dict):
                image = str(svc.get("image") or "")
            slice_text = _service_raw_slice(raw_text, name)
            services_out.append(
                {
                    "name": name,
                    "image": image,
                    "image_var": _image_var_from_slice(slice_text),
                }
            )
    return {"services": services_out, "networks": network_names, "warning": warning}


def _started_at(obj: dict[str, Any]) -> str:
    created_at = obj.get("CreatedAt")
    if isinstance(created_at, str) and created_at.strip():
        return created_at.strip()
    created = obj.get("Created")
    if isinstance(created, str) and created.strip():
        return created.strip()
    if isinstance(created, bool):
        return ""
    if isinstance(created, (int, float)) and created > 0:
        return datetime.fromtimestamp(int(created), UTC).isoformat()
    return ""


def _map_ps_row(obj: dict[str, Any]) -> dict[str, str]:
    service = str(obj.get("Service") or "")
    container = obj.get("Name") or obj.get("Names") or ""
    return {
        "service": service,
        "name": service,
        "container": str(container),
        "state": str(obj.get("State") or obj.get("Status") or ""),
        "health": str(obj.get("Health") or ""),
        "image": str(obj.get("Image") or ""),
        "started_at": _started_at(obj),
    }


def parse_compose_ps(stdout: str) -> list[dict[str, str]]:
    text = stdout.strip()
    if not text:
        return []
    items: list[dict[str, Any]]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        items = parsed
    else:
        items = []
        for line in stdout.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            try:
                items.append(json.loads(stripped))
            except json.JSONDecodeError as exc:
                raise ValueError("unparseable compose ps output") from exc
        if not items:
            raise ValueError("unparseable compose ps output")
    return [_map_ps_row(obj) for obj in items if isinstance(obj, dict)]


def compose_ps(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    slug: str,
) -> dict[str, Any]:
    _row, project_dir, compose_file = require_compose_project(settings, db, slug)
    result = runner(
        compose_base_argv(slug, compose_file) + ["ps", "--format", "json"],
        cwd=project_dir,
        check=True,
        timeout=120,
    )
    services = parse_compose_ps(result.stdout)
    return {"services": services}
