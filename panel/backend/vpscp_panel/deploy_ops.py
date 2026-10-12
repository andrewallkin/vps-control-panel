from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.models import Deploy, Project, ProjectService


class DeployAlreadyRunningError(Exception):
    pass


def _parse_sse_block(block: bytes) -> tuple[str | None, str | None]:
    event_type: str | None = None
    data: str | None = None
    for line in block.decode().splitlines():
        if line.startswith("event:"):
            event_type = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data = line[len("data:") :].strip()
    return event_type, data


async def consume_job_events(agent: AgentClient, job_id: str) -> tuple[list[str], dict[str, Any]]:
    buffer = b""
    log_lines: list[str] = []
    end_data: dict[str, Any] | None = None
    async for chunk in agent.stream(f"/v1/jobs/{job_id}/events"):
        buffer += chunk
        while b"\n\n" in buffer:
            block, buffer = buffer.split(b"\n\n", 1)
            if not block.strip():
                continue
            event_type, data_str = _parse_sse_block(block)
            if event_type is None or data_str is None:
                continue
            payload = json.loads(data_str)
            if event_type == "line":
                log_lines.append(str(payload["text"]))
            elif event_type == "end":
                end_data = payload
    if end_data is None:
        raise RuntimeError("job stream ended without end event")
    return log_lines, end_data


def build_agent_deploy_body(
    project: Project,
    tags: dict[str, str],
    *,
    run_migrations: bool = True,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "tags": tags,
        "mode": project.deploy_mode,
        "db": project.database_mode != "none",
    }
    if run_migrations and project.migration_service and project.migration_command:
        body["migration"] = {
            "service": project.migration_service,
            "command": project.migration_command,
        }
    if project.health_check_url is not None:
        body["health_url"] = project.health_check_url
    return body


def _terminal_deploy_status(end_status: str, error: str | None) -> str:
    if end_status == "succeeded":
        return "succeeded"
    if error:
        if "failed_after_switch" in error:
            return "failed_after_switch"
        if "failed_before_switch" in error:
            return "failed_before_switch"
    return "failed"


def _apply_end_event(
    db: DbSession,
    deploy: Deploy,
    project: Project,
    log_lines: list[str],
    end_data: dict[str, Any],
    now: datetime,
) -> None:
    deploy.log = "\n".join(log_lines)
    end_status = str(end_data.get("status", "failed"))
    error = end_data.get("error")
    error_str = str(error) if error is not None else None
    deploy.status = _terminal_deploy_status(end_status, error_str)
    deploy.finished_at = now
    if deploy.status == "succeeded":
        result = end_data.get("result")
        if isinstance(result, dict):
            commit = result.get("commit")
            if isinstance(commit, str):
                deploy.commit = commit
            if project.deploy_mode == "image":
                result_tags = result.get("tags")
                if isinstance(result_tags, dict):
                    deploy.tags_json = json.dumps(result_tags)
                    rows = db.scalars(
                        select(ProjectService).where(ProjectService.project_slug == project.slug)
                    ).all()
                    by_env = {row.image_env_var: row for row in rows}
                    for key, tag_value in result_tags.items():
                        row = by_env.get(str(key))
                        if row is not None:
                            row.current_tag = str(tag_value)


def deploy_row_payload(row: Deploy) -> dict[str, Any]:
    return {
        "id": row.id,
        "status": row.status,
        "trigger": row.trigger,
        "tags": json.loads(row.tags_json),
        "commit": row.commit,
        "started_at": row.started_at.isoformat(),
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "log": row.log,
    }


def project_creation_ready(project: Project) -> bool:
    state = json.loads(project.creation_state)
    return state.get("status") == "ready"


def has_running_deploy(db: DbSession, slug: str) -> bool:
    row = db.scalars(
        select(Deploy).where(Deploy.project_slug == slug, Deploy.status == "running")
    ).first()
    return row is not None


async def run_deploy(
    db: DbSession,
    agent: AgentClient,
    project: Project,
    *,
    tags: dict[str, str],
    trigger: str,
    clock: Callable[[], datetime],
    run_migrations: bool = True,
) -> Deploy:
    deploy = Deploy(
        project_slug=project.slug,
        started_at=clock(),
        finished_at=None,
        status="running",
        tags_json=json.dumps(tags),
        log="",
        trigger=trigger,
        commit=None,
    )
    db.add(deploy)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise DeployAlreadyRunningError from None
    db.refresh(deploy)

    agent_body = build_agent_deploy_body(project, tags, run_migrations=run_migrations)
    try:
        start = await agent.post(f"/v1/projects/{project.slug}/deploy", json=agent_body)
        job_id = start["job_id"]
        deploy.job_id = job_id
        db.commit()
        log_lines, end_data = await consume_job_events(agent, job_id)
        _apply_end_event(db, deploy, project, log_lines, end_data, clock())
    except BaseException as exc:
        # A cancelled deploy (client disconnect, panel shutdown) must never
        # leave status='running' behind: it 409s every future deploy.
        deploy.status = "failed"
        deploy.finished_at = clock()
        prefix = deploy.log
        msg = str(exc) if str(exc) else type(exc).__name__
        deploy.log = f"{prefix}\n{msg}".strip() if prefix else msg
        db.commit()
        db.refresh(deploy)
        if isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt, SystemExit)):
            raise
        return deploy
    db.commit()
    db.refresh(deploy)
    return deploy


async def reconcile_deploy_jobs(
    session_factory, agent: AgentClient, clock: Callable[[], datetime]
) -> None:
    """Finalize 'running' deploys whose agent job reached a terminal state.

    A panel restart mid-deploy leaves the row 'running' while the agent job
    keeps running and switches containers on its own. Mass-failing the row
    would lie about what shipped; instead consult the agent (job records are
    persistent) and finalize to its state. A vanished job is 'failed'.
    """
    from vpscp_panel.models import Deploy, Project

    reattached: list[tuple[int, str, str]] = []
    with session_factory() as db:
        rows = db.scalars(select(Deploy).where(Deploy.status == "running")).all()
        for row in rows:
            if not row.job_id:
                row.status = "failed"
                row.finished_at = clock()
                row.log = (row.log + "\n" + "interrupted: no agent job recorded").strip()
                continue
            try:
                job = await agent.get(f"/v1/jobs/{row.job_id}")
            except AgentError as exc:
                if exc.status == 404:
                    row.status = "failed"
                    row.finished_at = clock()
                    row.log = (row.log + "\n" + "interrupted: agent job vanished").strip()
                continue
            status = job.get("status")
            if status in ("succeeded", "failed"):
                project = db.get(Project, row.project_slug)
                end_data = {
                    "status": status,
                    "result": job.get("result"),
                    "error": job.get("error"),
                }
                if project is not None:
                    _apply_end_event(db, row, project, [], end_data, clock())
                else:
                    row.status = "failed"
                    row.finished_at = clock()
            else:
                # Still running: re-attach to the agent job stream so the row
                # finalizes when the job does, instead of running forever.
                reattached.append((row.id, row.project_slug, row.job_id))
        db.commit()

    for deploy_id, project_slug, job_id in reattached:
        asyncio.create_task(
            _reattach_deploy(session_factory, agent, deploy_id, project_slug, job_id, clock)
        )


async def _reattach_deploy(
    session_factory,
    agent: AgentClient,
    deploy_id: int,
    project_slug: str,
    job_id: str,
    clock: Callable[[], datetime],
) -> None:
    from vpscp_panel.models import Deploy, Project

    try:
        log_lines, end_data = await consume_job_events(agent, job_id)
    except Exception as exc:  # noqa: BLE001
        with session_factory() as db:
            row = db.get(Deploy, deploy_id)
            if row is not None:
                row.status = "failed"
                row.finished_at = clock()
                row.log = (row.log + "\n" + str(exc)).strip()
                db.commit()
        return
    with session_factory() as db:
        row = db.get(Deploy, deploy_id)
        project = db.get(Project, project_slug)
        if row is not None and project is not None:
            _apply_end_event(db, row, project, log_lines, end_data, clock())
            db.commit()


def reconcile_stuck_work(db: DbSession, clock: Callable[[], datetime]) -> None:
    """Mark creations stranded in 'running' by a dead process as failed so
    retries work. Deploy rows are NOT mass-failed here: the agent job may
    still be running — reconcile_deploy_jobs finalizes each row from the
    agent's own terminal state instead of guessing (a mass-fail would lie
    about containers that actually switched)."""

    from vpscp_panel.models import Project

    projects = db.scalars(select(Project)).all()
    changed = False
    for project in projects:
        state = json.loads(project.creation_state)
        if state.get("status") == "running":
            state["status"] = "failed"
            state["error"] = "interrupted: panel restarted while creating"
            project.creation_state = json.dumps(state)
            changed = True
    if changed:
        db.commit()
