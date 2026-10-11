from __future__ import annotations

import select
import subprocess
from collections.abc import AsyncIterator

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from starlette.responses import StreamingResponse

from vpscp_agent import audit
from vpscp_agent.compose_ops import (
    compose_base_argv,
    compose_job_body,
    compose_ps,
    get_compose_services,
    migrate_argv,
    run_compose_job,
    validate_compose_service_name,
)
from vpscp_agent.jobs import JobLockedError
from vpscp_agent.validation import Slug, validate_project_slug

router = APIRouter(prefix="/v1/projects", tags=["compose"])


class MigrateBody(BaseModel):
    service: str
    command: str


@router.get("/{slug}/compose-services")
def get_compose_services_route(slug: Slug, request: Request) -> dict:
    settings = request.app.state.settings
    db = request.app.state.db
    runner = request.app.state.runner
    validate_project_slug(slug)
    return get_compose_services(settings, db, runner, slug)


@router.get("/{slug}/compose/ps")
def get_compose_ps_route(slug: Slug, request: Request) -> dict:
    settings = request.app.state.settings
    db = request.app.state.db
    runner = request.app.state.runner
    validate_project_slug(slug)
    return compose_ps(settings, db, runner, slug)


@router.post("/{slug}/compose/pull", status_code=202)
def post_compose_pull(slug: Slug, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    job = jobs.start(
        "compose.pull",
        {"slug": slug},
        compose_job_body(settings, db, runner, slug, ["pull"]),
        lock_key=f"deploy:{slug}",
    )
    return {"job_id": job.id}


@router.post("/{slug}/compose/build", status_code=202)
def post_compose_build(slug: Slug, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    job = jobs.start(
        "compose.build",
        {"slug": slug},
        compose_job_body(settings, db, runner, slug, ["build"]),
        lock_key=f"deploy:{slug}",
    )
    return {"job_id": job.id}


@router.post("/{slug}/compose/up", status_code=202)
def post_compose_up(slug: Slug, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    job = jobs.start(
        "compose.up",
        {"slug": slug},
        compose_job_body(settings, db, runner, slug, ["up", "-d", "--remove-orphans"]),
        lock_key=f"deploy:{slug}",
    )
    return {"job_id": job.id}


@router.post("/{slug}/compose/restart")
def post_compose_restart(slug: Slug, request: Request) -> dict[str, bool]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    lock_key = f"deploy:{slug}"
    if jobs.is_locked(lock_key):
        raise JobLockedError(lock_key)
    params = {"slug": slug}
    with audit.audited(db, "compose.restart", params):
        run_compose_job(settings, db, runner, slug, ["restart"])
    return {"ok": True}


@router.post("/{slug}/compose/down")
def post_compose_down(slug: Slug, request: Request) -> dict[str, bool]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    lock_key = f"deploy:{slug}"
    if jobs.is_locked(lock_key):
        raise JobLockedError(lock_key)
    params = {"slug": slug}
    with audit.audited(db, "compose.down", params):
        run_compose_job(settings, db, runner, slug, ["down"])
    return {"ok": True}


@router.post("/{slug}/compose/migrate", status_code=202)
def post_compose_migrate(slug: Slug, body: MigrateBody, request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    validate_project_slug(slug)
    extra = migrate_argv(body.service, body.command)
    job = jobs.start(
        "compose.migrate",
        {"slug": slug, "service": body.service, "command": body.command},
        compose_job_body(settings, db, runner, slug, extra),
        lock_key=f"deploy:{slug}",
    )
    return {"job_id": job.id}


async def _stream_compose_logs(
    request: Request,
    args: list[str],
    cwd: subprocess.PathLike[str],
) -> AsyncIterator[str]:
    popen_factory = getattr(request.app.state, "compose_popen", subprocess.Popen)
    proc = popen_factory(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=cwd,
    )
    assert proc.stdout is not None
    fd = proc.stdout.fileno()
    try:
        while True:
            if await request.is_disconnected():
                proc.kill()
                break
            ready, _, _ = select.select([fd], [], [], 1.0)
            if not ready:
                continue
            line = proc.stdout.readline()
            if line == "":
                break
            yield f"data: {line.rstrip(chr(10))}\n\n"
    finally:
        proc.kill()
        proc.wait()


@router.get("/{slug}/compose/logs")
async def get_compose_logs(
    slug: Slug,
    request: Request,
    service: str | None = None,
    tail: int = Query(200, ge=1, le=5000),
    follow: int = Query(1),
) -> StreamingResponse:
    from vpscp_agent.compose_ops import require_compose_project

    settings = request.app.state.settings
    db = request.app.state.db
    validate_project_slug(slug)
    if service is not None:
        validate_compose_service_name(service)
    _row, project_dir, compose_file = require_compose_project(settings, db, slug)
    args = compose_base_argv(slug, compose_file) + [
        "logs",
        "--no-color",
        "--timestamps",
        "--tail",
        str(tail),
    ]
    if follow:
        args.append("--follow")
    if service:
        args.append(service)

    return StreamingResponse(
        _stream_compose_logs(request, args, project_dir),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
