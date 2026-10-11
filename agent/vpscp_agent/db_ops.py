from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel

from vpscp_agent.pg import Psql, generate_password, quote_ident
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_slug, validate_sql_ident


class ConflictError(Exception):
    pass


RESERVED_DATABASES = frozenset({"postgres", "template0", "template1"})

_LIST_DATABASES_SQL = """
SELECT d.datname, pg_get_userbyid(d.datdba), pg_database_size(d.datname)
FROM pg_database d WHERE NOT d.datistemplate AND d.datname <> 'postgres' ORDER BY 1;
""".strip()

_LIST_ROLES_SQL = """
SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY 1;
""".strip()


class DatabaseInfo(BaseModel):
    name: str
    owner: str
    size_bytes: int
    attached_slug: str | None


def default_names(slug: str) -> tuple[str, str]:
    validate_slug(slug)
    base = slug.replace("-", "_")
    return base, f"{base}_user"


def _load_attachments(db: StateDB) -> dict[str, str]:
    with db.connect() as conn:
        rows = conn.execute("SELECT db_name, slug FROM db_attachment").fetchall()
    return {row["db_name"]: row["slug"] for row in rows}


def list_databases(psql: Psql, db: StateDB) -> list[DatabaseInfo]:
    attachments = _load_attachments(db)
    rows = psql.query_rows(_LIST_DATABASES_SQL)
    out: list[DatabaseInfo] = []
    for row in rows:
        if not row:
            continue
        name, owner, size_raw = row[0], row[1], row[2]
        out.append(
            DatabaseInfo(
                name=name,
                owner=owner,
                size_bytes=int(size_raw),
                attached_slug=attachments.get(name),
            )
        )
    return out


def list_roles(psql: Psql) -> list[str]:
    rows = psql.query_rows(_LIST_ROLES_SQL)
    return [row[0] for row in rows if row]


def _attachment_taken(db: StateDB, *, slug: str, db_name: str) -> bool:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM db_attachment WHERE db_name = ? OR slug = ? LIMIT 1",
            (db_name, slug),
        ).fetchone()
    return row is not None


def _database_exists(psql: Psql, db_name: str) -> bool:
    sql = f"SELECT 1 FROM pg_database WHERE datname = '{db_name}';"
    return bool(psql.query_rows(sql))


def _role_exists(psql: Psql, db_user: str) -> bool:
    sql = f"SELECT 1 FROM pg_roles WHERE rolname = '{db_user}';"
    return bool(psql.query_rows(sql))


def _insert_attachment(db: StateDB, *, db_name: str, db_user: str, slug: str) -> None:
    ts = datetime.now(UTC).isoformat(timespec="seconds")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            (db_name, db_user, slug, ts),
        )


def _create_sql(db_name: str, db_user: str) -> tuple[str, str]:
    user_q = quote_ident(db_user)
    db_q = quote_ident(db_name)
    call1 = (
        "\\getenv pw VPSCP_PW\n"
        f"CREATE ROLE {user_q} WITH LOGIN PASSWORD :'pw';\n"
        f"CREATE DATABASE {db_q};\n"
        f"REVOKE CONNECT ON DATABASE {db_q} FROM PUBLIC;\n"
        f"GRANT CONNECT ON DATABASE {db_q} TO {user_q};\n"
    )
    call2 = (
        f"GRANT USAGE, CREATE ON SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO {user_q};\n"
    )
    return call1, call2


def _cleanup_database_and_role(psql: Psql, *, db_name: str, db_user: str) -> None:
    db_q = quote_ident(db_name)
    user_q = quote_ident(db_user)
    psql.exec_sql(
        f"DROP DATABASE IF EXISTS {db_q};\nDROP ROLE IF EXISTS {user_q};\n",
        database="postgres",
        on_error_stop=False,
    )


def create_database(
    psql: Psql,
    db: StateDB,
    *,
    slug: str,
    db_name: str,
    db_user: str,
) -> str:
    validate_slug(slug)
    validate_sql_ident(db_name)
    validate_sql_ident(db_user)
    if db_name in RESERVED_DATABASES:
        raise ConflictError(f"database already exists: {db_name!r}")
    if _attachment_taken(db, slug=slug, db_name=db_name):
        raise ConflictError("database or slug already attached")
    if _database_exists(psql, db_name):
        raise ConflictError(f"database already exists: {db_name!r}")
    if _role_exists(psql, db_user):
        raise ConflictError(f"role already exists: {db_user!r}")

    password = generate_password()
    call1, call2 = _create_sql(db_name, db_user)
    psql.exec_sql(call1, database="postgres", secrets={"VPSCP_PW": password})
    try:
        psql.exec_sql(call2, database=db_name)
    except Exception:
        _cleanup_database_and_role(psql, db_name=db_name, db_user=db_user)
        raise

    _insert_attachment(db, db_name=db_name, db_user=db_user, slug=slug)
    return password


def rotate_password(psql: Psql, *, db_user: str) -> str:
    validate_sql_ident(db_user)
    if db_user == psql.admin_user():
        raise ValueError("cannot rotate password for admin role")
    password = generate_password()
    user_q = quote_ident(db_user)
    sql = f"\\getenv pw VPSCP_PW\nALTER ROLE {user_q} WITH PASSWORD :'pw';\n"
    psql.exec_sql(sql, database="postgres", secrets={"VPSCP_PW": password})
    return password


def verify_password(psql: Psql, *, db_user: str, password: str, db_name: str) -> bool:
    validate_sql_ident(db_user)
    validate_sql_ident(db_name)
    return psql.verify_login(db_user, password, db_name)
