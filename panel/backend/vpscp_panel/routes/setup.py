from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.auth import current_session, get_db, require_csrf
from vpscp_panel.models import Domain, Session
from vpscp_panel.settings_store import get_setting
from vpscp_panel.setup_helpers import (
    load_setup,
    public_setup_state,
    require_step_up_if_completed,
    save_setup,
)

router = APIRouter(tags=["setup"])

CHUNK_MAX = 16 * 1024 * 1024


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


def _load_setup(db: DbSession) -> dict[str, Any]:
    return load_setup(db)


def _save_setup(db: DbSession, setup: dict[str, Any]) -> None:
    save_setup(db, setup)


def _public_state(setup: dict[str, Any], db: DbSession) -> dict[str, Any]:
    return public_setup_state(setup, db)


def _require_step_up_if_completed(
    request: Request,
    db: DbSession,
    session: Session,
) -> None:
    require_step_up_if_completed(request, db, session)


async def require_setup_mutate(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
) -> Session:
    _require_step_up_if_completed(request, db, session)
    return session


class UploadCreateBody(BaseModel):
    filename: str
    size: int


class UploadCompleteBody(BaseModel):
    sha256: str


class RestoreBody(BaseModel):
    upload_id: str
    confirm: str


async def _maybe_sync_restore_job(
    db: DbSession,
    agent: AgentClient,
    setup: dict[str, Any],
) -> dict[str, Any]:
    job_id = setup.get("restore_job_id")
    if not job_id or setup.get("database") == "restored":
        return setup
    try:
        job = await agent.get(f"/v1/jobs/{job_id}")
    except AgentError:
        return setup
    if job.get("status") == "succeeded":
        setup = dict(setup)
        setup["database"] = "restored"
        _save_setup(db, setup)
    return setup


@router.get("/api/setup/state")
async def get_setup_state(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, Any]:
    setup = _load_setup(db)
    setup = await _maybe_sync_restore_job(db, agent, setup)
    return _public_state(setup, db)


@router.post("/api/setup/database/empty")
def mark_database_empty(
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    setup = _load_setup(db)
    setup["database"] = "empty"
    _save_setup(db, setup)
    return _public_state(setup, db)


@router.post("/api/setup/uploads")
async def create_upload(
    body: UploadCreateBody,
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> Any:
    return await agent.post(
        "/v1/restore/uploads",
        json={"filename": body.filename, "size": body.size},
    )


@router.put("/api/setup/uploads/{upload_id}")
async def upload_chunk(
    upload_id: str,
    request: Request,
    offset: Annotated[int, Query()],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> Any:
    body = await request.body()
    if len(body) > CHUNK_MAX:
        raise HTTPException(status_code=413, detail="chunk_too_large")
    return await agent.put_bytes(
        f"/v1/restore/uploads/{upload_id}",
        body,
        params={"offset": offset},
    )


@router.get("/api/setup/uploads/{upload_id}")
async def get_upload(
    upload_id: str,
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> Any:
    _require_step_up_if_completed(request, db, session)
    return await agent.get(f"/v1/restore/uploads/{upload_id}")


@router.delete("/api/setup/uploads/{upload_id}", status_code=204)
async def delete_upload(
    upload_id: str,
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> Response:
    await agent.delete(f"/v1/restore/uploads/{upload_id}")
    return Response(status_code=204)


@router.post("/api/setup/uploads/{upload_id}/complete")
async def complete_upload(
    upload_id: str,
    body: UploadCompleteBody,
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> Any:
    return await agent.post(
        f"/v1/restore/uploads/{upload_id}/complete",
        json={"sha256": body.sha256},
    )


@router.post("/api/setup/restore")
async def run_restore(
    body: RestoreBody,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(require_setup_mutate)],
) -> dict[str, str]:
    if body.confirm != "RESTORE":
        raise HTTPException(status_code=400, detail="confirm must be RESTORE")
    result = await agent.post(
        "/v1/restore/run",
        json={"upload_id": body.upload_id, "confirm": body.confirm},
    )
    setup = _load_setup(db)
    setup["restore_job_id"] = result["job_id"]
    _save_setup(db, setup)
    return {"job_id": result["job_id"]}


@router.post("/api/setup/complete")
def complete_setup(
    request: Request,
    db: Annotated[DbSession, Depends(get_db)],
    session: Annotated[Session, Depends(require_csrf)],
) -> dict[str, Any]:
    setup = _load_setup(db)
    _require_step_up_if_completed(request, db, session)
    if setup.get("database") == "pending":
        raise HTTPException(status_code=409, detail="database_pending")
    if setup.get("cloudflare") != "done":
        raise HTTPException(status_code=409, detail="cloudflare_pending")
    if db.query(Domain).count() < 1:
        raise HTTPException(status_code=409, detail="domains_pending")
    if not get_setting(db, "panel_hostname"):
        raise HTTPException(status_code=409, detail="panel_hostname_pending")
    setup["completed"] = True
    _save_setup(db, setup)
    return _public_state(setup, db)
