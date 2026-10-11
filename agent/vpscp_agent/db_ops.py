from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

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


def _grant_public_schema_sql(db_user: str) -> str:
    user_q = quote_ident(db_user)
    return (
        f"GRANT USAGE, CREATE ON SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO {user_q};\n"
    )


def _ownership_do_block(admin: str, db_user: str) -> str:
    validate_sql_ident(admin)
    validate_sql_ident(db_user)
    return f"""DO $vpscp$
DECLARE r record; admin text := '{admin}'; target text := '{db_user}';
BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = admin
             AND c.relkind IN ('r','p','v','m','S','f') LOOP
    IF r.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class s ON s.oid = d.objid
         WHERE s.relname = r.relname AND d.deptype IN ('a','i')) THEN CONTINUE; END IF;
    EXECUTE format('ALTER %s public.%I OWNER TO %I',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE'
                     WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.relname, target);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = admin LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.sig, target);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND pg_get_userbyid(t.typowner) = admin AND t.typtype IN ('e','d','c')
             AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid AND c.relkind <> 'c') LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO %I', r.typname, target);
  END LOOP;
END $vpscp$;"""


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
    call2 = _grant_public_schema_sql(db_user)
    return call1, call2


def _adopt_postgres_sql(db_name: str, db_user: str) -> str:
    user_q = quote_ident(db_user)
    db_q = quote_ident(db_name)
    return (
        f"REVOKE CONNECT ON DATABASE {db_q} FROM PUBLIC;\n"
        f"GRANT CONNECT ON DATABASE {db_q} TO {user_q};\n"
        f"ALTER DATABASE {db_q} OWNER TO {user_q};\n"
    )


def _adopt_database_sql(db_user: str, admin: str) -> str:
    return _grant_public_schema_sql(db_user) + _ownership_do_block(admin, db_user) + "\n"


def _attachment_user(db: StateDB, db_name: str) -> str | None:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT db_user FROM db_attachment WHERE db_name = ?", (db_name,)
        ).fetchone()
    return row["db_user"] if row else None


def _remove_attachment(db: StateDB, *, db_name: str) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM db_attachment WHERE db_name = ?", (db_name,))


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


def adopt_database(
    psql: Psql,
    db: StateDB,
    *,
    slug: str,
    db_name: str,
    db_user: str,
    password_mode: Literal["rotate", "keep"],
    password: str | None,
) -> str | None:
    validate_slug(slug)
    validate_sql_ident(db_name)
    validate_sql_ident(db_user)
    if db_name in RESERVED_DATABASES:
        raise ConflictError(f"cannot adopt reserved database: {db_name!r}")
    if db_user == psql.admin_user():
        raise ConflictError("cannot adopt using admin role")
    if _attachment_taken(db, slug=slug, db_name=db_name):
        raise ConflictError("database or slug already attached")
    if not _database_exists(psql, db_name):
        raise ValueError(f"database does not exist: {db_name!r}")
    if not _role_exists(psql, db_user):
        raise ValueError(f"role does not exist: {db_user!r}")

    if password_mode == "keep":
        if password is None:
            raise ValueError("password required for keep mode")
        if not verify_password(psql, db_user=db_user, password=password, db_name=db_name):
            raise ValueError("password verification failed")

    psql.exec_sql(_adopt_postgres_sql(db_name, db_user), database="postgres")
    psql.exec_sql(
        _adopt_database_sql(db_user, psql.admin_user()),
        database=db_name,
    )

    new_password: str | None
    if password_mode == "rotate":
        new_password = rotate_password(psql, db_user=db_user)
    else:
        new_password = None

    _insert_attachment(db, db_name=db_name, db_user=db_user, slug=slug)
    return new_password


def detach(db: StateDB, *, slug: str) -> None:
    validate_slug(slug)
    with db.connect() as conn:
        conn.execute("DELETE FROM db_attachment WHERE slug = ?", (slug,))


def drop_database(
    psql: Psql,
    db: StateDB,
    *,
    db_name: str,
    confirm: str,
    drop_role: bool,
) -> None:
    validate_sql_ident(db_name)
    if confirm != db_name:
        raise ValueError("confirm must match db_name")
    if db_name in RESERVED_DATABASES:
        raise ValueError(f"cannot drop reserved database: {db_name!r}")

    attached_user = _attachment_user(db, db_name)
    db_q = quote_ident(db_name)
    psql.exec_sql(f"DROP DATABASE {db_q} WITH (FORCE);\n", database="postgres")
    if drop_role and attached_user is not None:
        user_q = quote_ident(attached_user)
        psql.exec_sql(f"DROP ROLE IF EXISTS {user_q};\n", database="postgres")
    _remove_attachment(db, db_name=db_name)
