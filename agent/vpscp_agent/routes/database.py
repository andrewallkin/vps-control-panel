from fastapi import APIRouter, Request
from pydantic import BaseModel

from vpscp_agent import audit
from vpscp_agent.db_ops import (
    DatabaseInfo,
    create_database,
    list_databases,
    list_roles,
    rotate_password,
    verify_password,
)
from vpscp_agent.validation import Slug, SqlIdent, validate_env_value

router = APIRouter(prefix="/v1/db", tags=["database"])


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


@router.get("/databases")
def get_databases(request: Request) -> list[DatabaseInfo]:
    return list_databases(request.app.state.psql, request.app.state.db)


@router.get("/roles")
def get_roles(request: Request) -> list[str]:
    return list_roles(request.app.state.psql)


@router.post("/create", status_code=201)
def post_create(body: CreateDatabaseBody, request: Request) -> dict[str, str]:
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
    db = request.app.state.db
    psql = request.app.state.psql
    params = {"db_user": body.db_user}
    with audit.audited(db, "db.rotate_password", params):
        password = rotate_password(psql, db_user=body.db_user)
    return {"password": password}


@router.post("/verify-password")
def post_verify_password(body: VerifyPasswordBody, request: Request) -> dict[str, bool]:
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
