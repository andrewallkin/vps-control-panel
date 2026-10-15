from __future__ import annotations

import re
import time
from collections.abc import Callable
from typing import Any, Literal

import httpx

from vpscp_agent import dumps
from vpscp_agent.compose_ops import compose_ps, migrate_argv, run_compose_job
from vpscp_agent.config import Settings
from vpscp_agent.envfile import read_env
from vpscp_agent.jobs import JobContext
from vpscp_agent.pg import Psql
from vpscp_agent.project_env import patch_project_env
from vpscp_agent.projects import pull_project
from vpscp_agent.state import StateDB
from vpscp_agent.validation import safe_project_path, validate_project_slug

DOCKER_IMAGE_KEY_RE = re.compile(r"^DOCKER_IMAGE_[A-Z0-9_]+$")
DOCKER_IMAGE_VALUE_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
HEALTH_URL_RE = re.compile(r"^http://127\.0\.0\.1:(\d+)(/.*)?$")


class DeployFailed(Exception):
    def __init__(self, status: str, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(f"{status}: {message}")


def default_probe(url: str) -> int:
    try:
        response = httpx.get(url, timeout=5.0)
        return response.status_code
    except httpx.HTTPError:
        return 0


def validate_deploy_tags(mode: Literal["image", "build"], tags: dict[str, str]) -> None:
    if mode == "build":
        if tags:
            raise ValueError("tags must be empty for build mode")
        return
    if not tags:
        raise ValueError("tags must not be empty for image mode")
    for key, value in tags.items():
        if DOCKER_IMAGE_KEY_RE.fullmatch(key) is None:
            raise ValueError(f"invalid image tag key: {key!r}")
        if DOCKER_IMAGE_VALUE_RE.fullmatch(value) is None:
            raise ValueError(f"invalid image tag value for {key!r}")


def validate_deploy_health_url(db: StateDB, slug: str, health_url: str | None) -> None:
    if health_url is None:
        return
    match = HEALTH_URL_RE.fullmatch(health_url)
    if match is None:
        raise ValueError("invalid health_url")
    port = int(match.group(1))
    validate_project_slug(slug)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM port_allocation WHERE owner = ? AND port = ?",
            (slug, port),
        ).fetchone()
    if row is None:
        raise ValueError("health_url port is not allocated to this project")


def _restore_tags(
    settings: Settings,
    db: StateDB,
    slug: str,
    previous_tags: dict[str, str | None],
) -> None:
    set_values = {key: value for key, value in previous_tags.items() if value is not None}
    unset_keys = [key for key, value in previous_tags.items() if value is None]
    if not set_values and not unset_keys:
        return
    patch_project_env(settings, db, slug, set_values=set_values, unset_keys=unset_keys)


def _run_health_check(
    health_url: str,
    *,
    probe: Callable[[str], int],
    sleeper: Callable[[float], None],
    now: Callable[[], float],
) -> None:
    start = now()
    status = probe(health_url)
    if 200 <= status <= 399:
        return
    while now() - start < 60:
        sleeper(2)
        if now() - start >= 60:
            raise DeployFailed(
                "failed_after_switch",
                f"health check did not succeed within 60s (last status {status})",
            )
        status = probe(health_url)
        if 200 <= status <= 399:
            return
    raise DeployFailed(
        "failed_after_switch",
        f"health check did not succeed within 60s (last status {status})",
    )


def _check_containers_started(
    settings: Settings,
    db: StateDB,
    runner: Any,
    slug: str,
) -> None:
    result = compose_ps(settings, db, runner, slug)
    problems: list[str] = []
    for service in result["services"]:
        state = service["state"].strip().lower()
        if state == "running":
            continue
        container = service["container"]
        error = ""
        inspect = runner(
            ["docker", "inspect", container, "--format", "{{.State.Error}}"],
            check=False,
            timeout=60,
        )
        if inspect.returncode == 0:
            error = inspect.stdout.strip()
        if error:
            problems.append(
                f"service {service['service']} ({container}) did not start (state={state}): {error}"
            )
        else:
            problems.append(
                f"service {service['service']} ({container}) did not start (state={state})"
            )
    if problems:
        raise DeployFailed("failed_after_switch", "; ".join(problems))


def deploy_project(
    ctx: JobContext,
    settings: Settings,
    db: StateDB,
    runner: Any,
    psql: Psql,
    slug: str,
    *,
    tags: dict[str, str],
    mode: Literal["image", "build"],
    db_flag: bool,
    migration: dict[str, str] | None,
    health_url: str | None,
    probe: Callable[[str], int] = default_probe,
    sleeper: Callable[[float], None] = time.sleep,
    now: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    tags_written = False
    previous_tags: dict[str, str | None] = {}
    commit = ""
    dump_name: str | None = None

    try:
        ctx.log("==> step 1: git pull")
        pull_result = pull_project(settings, db, runner, slug)
        commit = pull_result["commit"]

        if mode == "image":
            ctx.log("==> step 2: write image tags")
            env_path = safe_project_path(settings.apps_dir, slug, ".env")
            envfile = read_env(env_path)
            previous_tags = {key: envfile.get(key) for key in tags}
            patch_project_env(settings, db, slug, set_values=tags, unset_keys=[])
            tags_written = True

        if mode == "image":
            ctx.log("==> step 3: compose pull")
            run_compose_job(settings, db, runner, slug, ["pull"], ctx=ctx)
        else:
            ctx.log("==> step 3: compose build")
            run_compose_job(settings, db, runner, slug, ["build"], ctx=ctx)

        if db_flag:
            ctx.log("==> step 4: database dump")
            dump_info = dumps.dump_project(settings, psql, runner, db, slug=slug, keep=5)
            dump_name = dump_info.name

        if migration is not None:
            ctx.log("==> step 5: migrate")
            service = migration["service"]
            command = migration["command"]
            run_compose_job(
                settings,
                db,
                runner,
                slug,
                migrate_argv(service, command),
                ctx=ctx,
            )
    except DeployFailed:
        raise
    except Exception as exc:
        if tags_written:
            try:
                _restore_tags(settings, db, slug, previous_tags)
            except Exception as restore_exc:
                raise DeployFailed(
                    "failed_before_switch",
                    f"{exc}; restore failed: {restore_exc}",
                ) from restore_exc
        raise DeployFailed("failed_before_switch", str(exc)) from exc

    try:
        ctx.log("==> step 6: compose up")
        run_compose_job(
            settings,
            db,
            runner,
            slug,
            ["up", "-d", "--remove-orphans"],
            ctx=ctx,
        )

        _check_containers_started(settings, db, runner, slug)

        if health_url is not None:
            ctx.log("==> step 7: health check")
            _run_health_check(health_url, probe=probe, sleeper=sleeper, now=now)
    except DeployFailed:
        raise
    except Exception as exc:
        raise DeployFailed("failed_after_switch", str(exc)) from exc

    return {
        "commit": commit,
        "tags": dict(tags),
        "previous_tags": previous_tags,
        "dump": dump_name if db_flag else None,
        "status": "succeeded",
    }


def deploy_job_body(
    settings: Settings,
    db: StateDB,
    runner: Any,
    psql: Psql,
    slug: str,
    *,
    tags: dict[str, str],
    mode: Literal["image", "build"],
    db_flag: bool,
    migration: dict[str, str] | None,
    health_url: str | None,
):
    def body(ctx: JobContext) -> dict[str, Any]:
        return deploy_project(
            ctx,
            settings,
            db,
            runner,
            psql,
            slug,
            tags=tags,
            mode=mode,
            db_flag=db_flag,
            migration=migration,
            health_url=health_url,
        )

    return body
