from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from starlette.responses import FileResponse

from vpscp_agent import audit
from vpscp_agent.db_ops import (
    DatabaseInfo,
    adopt_database,
    create_database,
    detach,
    drop_database,
    list_databases,
    list_roles,
    rotate_password,
    verify_password,
)
from vpscp_agent.dumps import DumpInfo, dump_path, dump_project, list_dumps
from vpscp_agent.jobs import JobLockedError
from vpscp_agent.validation import Slug, SqlIdent, validate_env_value

router = APIRouter(prefix="/v1/db", tags=["database"])


def _require_postgres_unlocked(request: Request) -> None:
    if request.app.state.jobs.is_locked("postgres"):
        raise JobLockedError("postgres")


class CreateDatabaseBody(BaseModel):
    slug: Slug
    db_name: SqlIdent
    db_user: SqlIdent


class RotatePasswordBody(BaseModel):
    db_user: SqlIdent


class VerifyPasswordBody(BaseModel):
    db_user: SqlIdent
    db_name: SqlIdent
    password: str


class AdoptDatabaseBody(BaseModel):
    slug: Slug
    db_name: SqlIdent
    db_user: SqlIdent
    password_mode: Literal["rotate", "keep"]
    password: str | None = None


class DropDatabaseBody(BaseModel):
    db_name: SqlIdent
    confirm: str
    drop_role: bool = False


class DetachDatabaseBody(BaseModel):
    slug: Slug


@router.get("/databases")
def get_databases(request: Request) -> list[DatabaseInfo]:
    return list_databases(request.app.state.psql, request.app.state.db)


@router.get("/roles")
def get_roles(request: Request) -> list[str]:
    return list_roles(request.app.state.psql)


@router.post("/create", status_code=201)
def post_create(body: CreateDatabaseBody, request: Request) -> dict[str, str]:
    _require_postgres_unlocked(request)
    db = request.app.state.db
    psql = request.app.state.psql
    params = {"slug": body.slug, "db_name": body.db_name, "db_user": body.db_user}
    with audit.audited(db, "db.create", params):
        password = create_database(
            psql,
            db,
            slug=body.slug,
            db_name=body.db_name,
            db_user=body.db_user,
        )
    return {"db_name": body.db_name, "db_user": body.db_user, "password": password}


@router.post("/rotate-password")
def post_rotate_password(body: RotatePasswordBody, request: Request) -> dict[str, str]:
    _require_postgres_unlocked(request)
    db = request.app.state.db
    psql = request.app.state.psql
    params = {"db_user": body.db_user}
    with audit.audited(db, "db.rotate_password", params):
        password = rotate_password(psql, db_user=body.db_user)
    return {"password": password}


@router.post("/verify-password")
def post_verify_password(body: VerifyPasswordBody, request: Request) -> dict[str, bool]:
    _require_postgres_unlocked(request)
    validate_env_value(body.password)
    db = request.app.state.db
    psql = request.app.state.psql
    params = {
        "db_user": body.db_user,
        "db_name": body.db_name,
        "password": body.password,
    }
    with audit.audited(db, "db.verify_password", params):
        ok = verify_password(
            psql,
            db_user=body.db_user,
            password=body.password,
            db_name=body.db_name,
        )
    return {"ok": ok}


@router.post("/adopt")
def post_adopt(body: AdoptDatabaseBody, request: Request) -> dict[str, str | None]:
    _require_postgres_unlocked(request)
    if body.password is not None:
        validate_env_value(body.password)
    db = request.app.state.db
    psql = request.app.state.psql
    params: dict[str, object] = {
        "slug": body.slug,
        "db_name": body.db_name,
        "db_user": body.db_user,
        "password_mode": body.password_mode,
    }
    if body.password is not None:
        params["password"] = body.password
    with audit.audited(db, "db.adopt", params):
        password = adopt_database(
            psql,
            db,
            slug=body.slug,
            db_name=body.db_name,
            db_user=body.db_user,
            password_mode=body.password_mode,
            password=body.password,
        )
    return {"password": password}


@router.post("/drop", status_code=204)
def post_drop(body: DropDatabaseBody, request: Request) -> Response:
    _require_postgres_unlocked(request)
    db = request.app.state.db
    psql = request.app.state.psql
    params = {
        "db_name": body.db_name,
        "confirm": body.confirm,
        "drop_role": body.drop_role,
    }
    with audit.audited(db, "db.drop", params):
        drop_database(
            psql,
            db,
            db_name=body.db_name,
            confirm=body.confirm,
            drop_role=body.drop_role,
        )
    return Response(status_code=204)


@router.post("/detach", status_code=204)
def post_detach(body: DetachDatabaseBody, request: Request) -> Response:
    _require_postgres_unlocked(request)
    db = request.app.state.db
    params = {"slug": body.slug}
    with audit.audited(db, "db.detach", params):
        detach(db, slug=body.slug)
    return Response(status_code=204)


@router.post("/dumps/{slug}")
def post_dump_project(slug: Slug, request: Request) -> DumpInfo:
    _require_postgres_unlocked(request)
    settings = request.app.state.settings
    db = request.app.state.db
    psql = request.app.state.psql
    runner = request.app.state.runner
    params = {"slug": slug}
    with audit.audited(db, "db.dump_project", params):
        return dump_project(settings, psql, runner, db, slug=slug)


@router.get("/dumps/{slug}")
def get_dumps(slug: Slug, request: Request) -> list[DumpInfo]:
    return list_dumps(request.app.state.settings, slug)


@router.get("/dumps/{slug}/{name}")
def get_dump_download(slug: Slug, name: str, request: Request) -> FileResponse:
    path = dump_path(request.app.state.settings, slug, name)
    if not path.is_file():
        raise ValueError(f"dump not found: {name!r}")
    return FileResponse(path, media_type="application/octet-stream", filename=name)
