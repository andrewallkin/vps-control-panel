from datetime import UTC, datetime

import pytest

from tests.fakes import FakeRunner
from vpscp_agent.commands import CommandError
from vpscp_agent.db_ops import (
    ConflictError,
    adopt_database,
    create_database,
    default_names,
    detach,
    drop_database,
    list_databases,
    list_roles,
    rotate_password,
    verify_password,
)
from vpscp_agent.pg import Psql, quote_ident
from vpscp_agent.state import StateDB


@pytest.fixture
def psql(settings, tmp_path):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    return Psql(settings, runner), runner


@pytest.fixture
def db(settings):
    state = StateDB(settings.state_db_path)
    state.migrate()
    return state


def test_default_names():
    assert default_names("budget-hq") == ("budget_hq", "budget_hq_user")


def test_list_roles(psql):
    psql_obj, runner = psql
    runner.on("pg_roles", stdout="app_user\nother\n")

    roles = list_roles(psql_obj)

    assert roles == ["app_user", "other"]
    assert "pg_roles" in runner.calls[0]["input_data"]
    assert runner.calls[0]["input_data"].strip().endswith("ORDER BY 1;")


def test_list_databases_joins_attachment(psql, db):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="myapp,pgadmin,4096\nother,pgadmin,8192\n")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("myapp", "myapp_user", "my-app", datetime.now(UTC).isoformat(timespec="seconds")),
        )

    dbs = list_databases(psql_obj, db)

    assert len(dbs) == 2
    assert dbs[0].name == "myapp" and dbs[0].attached_slug == "my-app"
    assert dbs[1].name == "other" and dbs[1].attached_slug is None


def test_create_database_sends_expected_sql_and_records_attachment(psql, db, monkeypatch):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="")
    runner.on("pg_roles", stdout="")
    runner.on("docker", stdout="")
    fixed = "abcdefghijklmnopqrstuvwxyz012345"
    monkeypatch.setattr("vpscp_agent.db_ops.generate_password", lambda: fixed)

    db_name = "budgethq"
    db_user = "budgethq_user"
    password = create_database(psql_obj, db, slug="budgethq", db_name=db_name, db_user=db_user)

    assert password == fixed
    assert len(runner.calls) == 4
    sql1 = runner.calls[2]["input_data"]
    user_q = quote_ident(db_user)
    db_q = quote_ident(db_name)
    assert sql1 == (
        "\\getenv pw VPSCP_PW\n"
        f"CREATE ROLE {user_q} WITH LOGIN PASSWORD :'pw';\n"
        f"CREATE DATABASE {db_q};\n"
        f"REVOKE CONNECT ON DATABASE {db_q} FROM PUBLIC;\n"
        f"GRANT CONNECT ON DATABASE {db_q} TO {user_q};\n"
    )
    assert fixed not in sql1
    assert runner.calls[2]["extra_env"] == {"VPSCP_PW": fixed}
    assert runner.calls[3]["args"][runner.calls[3]["args"].index("-d") + 1] == db_name
    sql2 = runner.calls[3]["input_data"]
    assert sql2 == (
        f"GRANT USAGE, CREATE ON SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO {user_q};\n"
    )

    with db.connect() as conn:
        row = conn.execute(
            "SELECT db_user, slug FROM db_attachment WHERE db_name = ?", (db_name,)
        ).fetchone()
    assert row["db_user"] == db_user and row["slug"] == "budgethq"


def test_create_database_conflict_when_role_exists(psql, db):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="")
    runner.on("pg_roles", stdout="budgethq_user\n")

    with pytest.raises(ConflictError):
        create_database(psql_obj, db, slug="budgethq", db_name="budgethq", db_user="budgethq_user")


def test_create_database_cleans_up_when_second_exec_fails(psql, db, monkeypatch):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="")
    runner.on("pg_roles", stdout="")
    runner.on("\\getenv pw VPSCP_PW", stdout="")
    runner.on("GRANT USAGE, CREATE ON SCHEMA public", stderr="grant failed", returncode=1)
    runner.on("DROP DATABASE", stdout="")
    monkeypatch.setattr(
        "vpscp_agent.db_ops.generate_password", lambda: "pw12345678901234567890123456789012"
    )

    with pytest.raises(CommandError):
        create_database(psql_obj, db, slug="budgethq", db_name="budgethq", db_user="budgethq_user")

    drop_sql = runner.calls[-1]["input_data"]
    assert "DROP DATABASE IF EXISTS" in drop_sql
    assert "DROP ROLE IF EXISTS" in drop_sql
    with db.connect() as conn:
        assert (
            conn.execute("SELECT 1 FROM db_attachment WHERE db_name = 'budgethq'").fetchone()
            is None
        )


def test_rotate_password_rejects_admin(psql):
    psql_obj, _runner = psql
    with pytest.raises(ValueError):
        rotate_password(psql_obj, db_user="pgadmin")


def test_rotate_password_alters_role(psql, monkeypatch):
    psql_obj, runner = psql
    runner.on("docker", stdout="")
    fixed = "newpass123456789012345678901234567"
    monkeypatch.setattr("vpscp_agent.db_ops.generate_password", lambda: fixed)

    password = rotate_password(psql_obj, db_user="app_user")

    assert password == fixed
    sql = runner.calls[0]["input_data"]
    assert sql == (
        f"\\getenv pw VPSCP_PW\nALTER ROLE {quote_ident('app_user')} WITH PASSWORD :'pw';\n"
    )
    assert fixed not in sql
    assert runner.calls[0]["extra_env"] == {"VPSCP_PW": fixed}


def test_verify_password_delegates_to_psql(psql):
    psql_obj, runner = psql
    runner.on("SELECT 1", stdout="1\n", returncode=0)

    assert verify_password(psql_obj, db_user="app_user", password="secret", db_name="appdb") is True


def _ownership_do_block(admin: str, target: str) -> str:
    return f"""DO $vpscp$
DECLARE r record; admin text := '{admin}'; target text := '{target}';
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


def test_adopt_database_rotate_mode_sql_and_attachment(psql, db, monkeypatch):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="1\n")
    runner.on("pg_roles", stdout="1\n")
    runner.on("docker", stdout="")
    fixed = "abcdefghijklmnopqrstuvwxyz012345"
    monkeypatch.setattr("vpscp_agent.db_ops.generate_password", lambda: fixed)

    db_name = "legacyapp"
    db_user = "legacyapp_user"
    password = adopt_database(
        psql_obj,
        db,
        slug="legacy-app",
        db_name=db_name,
        db_user=db_user,
        password_mode="rotate",
        password=None,
    )

    assert password == fixed
    assert len(runner.calls) == 5
    user_q = quote_ident(db_user)
    db_q = quote_ident(db_name)
    sql_postgres = runner.calls[2]["input_data"]
    assert sql_postgres == (
        f"REVOKE CONNECT ON DATABASE {db_q} FROM PUBLIC;\n"
        f"GRANT CONNECT ON DATABASE {db_q} TO {user_q};\n"
        f"ALTER DATABASE {db_q} OWNER TO {user_q};\n"
    )
    assert runner.calls[3]["args"][runner.calls[3]["args"].index("-d") + 1] == db_name
    sql_db = runner.calls[3]["input_data"]
    assert sql_db.startswith(
        f"GRANT USAGE, CREATE ON SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {user_q};\n"
        f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO {user_q};\n"
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO {user_q};\n"
    )
    assert _ownership_do_block("pgadmin", db_user) in sql_db
    assert "REASSIGN OWNED" not in sql_db.upper()
    rotate_sql = runner.calls[-1]["input_data"]
    assert "ALTER ROLE" in rotate_sql
    assert runner.calls[-1]["extra_env"] == {"VPSCP_PW": fixed}

    with db.connect() as conn:
        row = conn.execute(
            "SELECT db_user, slug FROM db_attachment WHERE db_name = ?", (db_name,)
        ).fetchone()
    assert row["db_user"] == db_user and row["slug"] == "legacy-app"


def test_adopt_database_keep_mode_verification_failure(psql, db):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="1\n")
    runner.on("pg_roles", stdout="1\n")
    runner.on("SELECT 1", stdout="", returncode=1)

    with pytest.raises(ValueError, match="password verification failed"):
        adopt_database(
            psql_obj,
            db,
            slug="legacy-app",
            db_name="legacyapp",
            db_user="legacyapp_user",
            password_mode="keep",
            password="wrong",
        )

    with db.connect() as conn:
        assert (
            conn.execute("SELECT 1 FROM db_attachment WHERE db_name = 'legacyapp'").fetchone()
            is None
        )


def test_adopt_database_keep_mode_no_password_rotation(psql, db):
    psql_obj, runner = psql
    runner.on("pg_database", stdout="1\n")
    runner.on("pg_roles", stdout="1\n")
    runner.on("SELECT 1", stdout="1\n", returncode=0)
    runner.on("docker", stdout="")

    password = adopt_database(
        psql_obj,
        db,
        slug="legacy-app",
        db_name="legacyapp",
        db_user="legacyapp_user",
        password_mode="keep",
        password="correct",
    )

    assert password is None
    assert not any("ALTER ROLE" in (c.get("input_data") or "") for c in runner.calls)


def test_drop_database_force_and_optional_role(psql, db):
    psql_obj, runner = psql
    runner.on("docker", stdout="")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            (
                "legacyapp",
                "legacyapp_user",
                "legacy-app",
                datetime.now(UTC).isoformat(timespec="seconds"),
            ),
        )

    drop_database(
        psql_obj,
        db,
        db_name="legacyapp",
        confirm="legacyapp",
        drop_role=True,
    )

    drop_sql = runner.calls[0]["input_data"]
    assert drop_sql == 'DROP DATABASE "legacyapp" WITH (FORCE);\n'
    role_sql = runner.calls[1]["input_data"]
    assert role_sql == 'DROP ROLE IF EXISTS "legacyapp_user";\n'
    with db.connect() as conn:
        assert (
            conn.execute("SELECT 1 FROM db_attachment WHERE db_name = 'legacyapp'").fetchone()
            is None
        )


def test_drop_database_confirm_mismatch(psql, db):
    psql_obj, _runner = psql
    with pytest.raises(ValueError, match="confirm"):
        drop_database(psql_obj, db, db_name="legacyapp", confirm="wrong", drop_role=False)


def test_drop_database_reserved(psql, db):
    psql_obj, _runner = psql
    with pytest.raises(ValueError):
        drop_database(psql_obj, db, db_name="postgres", confirm="postgres", drop_role=False)


def test_detach_removes_attachment(db):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            (
                "legacyapp",
                "legacyapp_user",
                "legacy-app",
                datetime.now(UTC).isoformat(timespec="seconds"),
            ),
        )

    detach(db, slug="legacy-app")

    with db.connect() as conn:
        assert (
            conn.execute("SELECT 1 FROM db_attachment WHERE slug = 'legacy-app'").fetchone() is None
        )
