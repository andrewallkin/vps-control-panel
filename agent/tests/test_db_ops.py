from datetime import UTC, datetime

import pytest

from tests.fakes import FakeRunner
from vpscp_agent.commands import CommandError
from vpscp_agent.db_ops import (
    ConflictError,
    create_database,
    default_names,
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
