from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.models import Deploy, Project


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


def build_agent_deploy_body(project: Project, tags: dict[str, str]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "tags": tags,
        "mode": project.deploy_mode,
        "db": project.database_mode != "none",
    }
    if project.migration_service and project.migration_command:
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
    now: datetime,
) -> Deploy:
    deploy = Deploy(
        project_slug=project.slug,
        started_at=now,
        finished_at=None,
        status="running",
        tags_json=json.dumps(tags),
        log="",
        trigger=trigger,
        commit=None,
    )
    db.add(deploy)
    db.commit()
    db.refresh(deploy)

    agent_body = build_agent_deploy_body(project, tags)
    try:
        start = await agent.post(f"/v1/projects/{project.slug}/deploy", json=agent_body)
        job_id = start["job_id"]
        log_lines, end_data = await consume_job_events(agent, job_id)
        _apply_end_event(deploy, project, log_lines, end_data, now)
    except Exception as exc:  # noqa: BLE001
        deploy.status = "failed"
        deploy.finished_at = now
        prefix = deploy.log
        msg = str(exc)
        deploy.log = f"{prefix}\n{msg}".strip() if prefix else msg
    db.commit()
    db.refresh(deploy)
    return deploy
