from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession
from starlette.responses import StreamingResponse

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db, require_csrf, require_step_up
from vpscp_panel.models import Project, Session
from vpscp_panel.project_creation import default_db_name
from vpscp_panel.validation import Slug, SqlIdent

router = APIRouter(prefix="/api/database", tags=["database"])


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


async def _write_rotated_password(agent: AgentClient, project: Project, password: str) -> None:
    set_values: dict[str, str] = {"POSTGRES_PASSWORD": password}
    if project.write_database_url:
        db_name = project.db_name or default_db_name(project.slug)
        encoded = quote(password, safe="")
        set_values["DATABASE_URL"] = (
            f"postgresql://{project.db_user}:{encoded}@postgres-central:5432/{db_name}"
        )
    await agent.patch(
        f"/v1/projects/{project.slug}/env",
        json={"set": set_values, "unset": []},
    )


class AdoptDatabaseBody(BaseModel):
    slug: Slug
    db_name: SqlIdent
    db_user: SqlIdent
    password_mode: Literal["rotate", "keep"]
    password: str | None = None
    write_database_url: bool = False


class RotateDatabaseBody(BaseModel):
    slug: Slug


class DropDatabaseBody(BaseModel):
    db_name: SqlIdent
    confirm: str
    drop_role: bool = False


@router.get("/databases")
async def list_all_databases(
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> list[dict[str, Any]]:
    result = await agent.get("/v1/db/databases")
    if not isinstance(result, list):
        raise HTTPException(status_code=502, detail="invalid databases response from agent")
    return result


@router.post("/adopt")
async def adopt_database(
    body: AdoptDatabaseBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, bool]:
    project = db.get(Project, body.slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    payload = {
        "slug": body.slug,
        "db_name": body.db_name,
        "db_user": body.db_user,
        "password_mode": body.password_mode,
        "password": body.password,
    }
    result = await agent.post("/v1/db/adopt", json=payload)
    password = result.get("password")
    if body.password_mode == "rotate":
        if not isinstance(password, str):
            raise HTTPException(status_code=502, detail="invalid adopt response from agent")
    elif body.password is None:
        raise HTTPException(status_code=400, detail="password required for keep mode")
    else:
        password = body.password

    project.database_mode = "adopted"
    project.db_name = body.db_name
    project.db_user = body.db_user
    project.write_database_url = body.write_database_url
    db.commit()

    await _write_rotated_password(agent, project, password)
    return {"restart_required": True}


@router.post("/rotate")
async def rotate_database(
    body: RotateDatabaseBody,
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict[str, bool]:
    project = db.get(Project, body.slug)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if not project.db_user or project.database_mode == "none":
        raise HTTPException(status_code=400, detail="project has no database user")

    result = await agent.post("/v1/db/rotate-password", json={"db_user": project.db_user})
    password = result.get("password")
    if not isinstance(password, str):
        raise HTTPException(status_code=502, detail="invalid rotate response from agent")

    await _write_rotated_password(agent, project, password)
    return {"restart_required": True}


@router.post("/drop", status_code=204)
async def drop_database(
    body: DropDatabaseBody,
    _session: Annotated[Session, Depends(require_csrf)],
    _step_up: Annotated[Session, Depends(require_step_up)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> Response:
    if body.confirm != body.db_name:
        raise HTTPException(status_code=400, detail="confirm must match database name")
    await agent.post(
        "/v1/db/drop",
        json={
            "db_name": body.db_name,
            "confirm": body.confirm,
            "drop_role": body.drop_role,
        },
    )
    return Response(status_code=204)


@router.get("/dumps/{slug}")
async def list_project_dumps(
    slug: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> Any:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await agent.get(f"/v1/db/dumps/{slug}")


async def _stream_dump(agent: AgentClient, path: str) -> AsyncIterator[bytes]:
    async for chunk in agent.stream(path):
        yield chunk


@router.get("/dumps/{slug}/{name}")
async def download_dump(
    slug: str,
    name: str,
    db: Annotated[DbSession, Depends(get_db)],
    agent: Annotated[AgentClient, Depends(_agent)],
    _session: Annotated[Session, Depends(current_session)],
) -> StreamingResponse:
    if db.get(Project, slug) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return StreamingResponse(
        _stream_dump(agent, f"/v1/db/dumps/{slug}/{name}"),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
