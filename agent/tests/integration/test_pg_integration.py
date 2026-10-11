from __future__ import annotations

import hashlib

import pytest

from tests.integration.conftest import clear_attachment, drop_db_and_role
from vpscp_agent.commands import run_command
from vpscp_agent.db_ops import adopt_database, create_database, rotate_password, verify_password
from vpscp_agent.dumps import dump_project
from vpscp_agent.jobs import Job, JobContext
from vpscp_agent.pg import Psql, quote_ident
from vpscp_agent.restore import UploadStore, restore_cluster

pytestmark = pytest.mark.integration


def _ctx() -> JobContext:
    return JobContext(Job(kind="integration", params={}))


def _complete_upload(store: UploadStore, data: bytes, filename: str = "cluster.sql.gz") -> str:
    upload_id = store.create(filename, len(data))
    store.append(upload_id, 0, data)
    digest = hashlib.sha256(data).hexdigest()
    store.complete(upload_id, digest)
    return upload_id


def _object_owners(psql: Psql, db_name: str, names: tuple[str, ...]) -> dict[str, str]:
    in_list = ", ".join(f"'{n}'" for n in names)
    rows = psql.query_rows(
        f"""
SELECT c.relname, pg_get_userbyid(c.relowner)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ({in_list});
""".strip(),
        database=db_name,
    )
    return {row[0]: row[1] for row in rows if row}


def _function_owner(psql: Psql, db_name: str, func_name: str) -> str:
    rows = psql.query_rows(
        f"""
SELECT pg_get_userbyid(p.proowner)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = '{func_name}';
""".strip(),
        database=db_name,
    )
    assert rows and rows[0]
    return rows[0][0]


def _database_owner(psql: Psql, db_name: str) -> str:
    rows = psql.query_rows(
        f"SELECT pg_get_userbyid(d.datdba) FROM pg_database d WHERE d.datname = '{db_name}';",
        database="postgres",
    )
    assert rows and rows[0]
    return rows[0][0]


def _legacy_cluster_setup(psql: Psql, *, db_name: str, db_user: str, password: str) -> None:
    user_q = quote_ident(db_user)
    db_q = quote_ident(db_name)
    psql.exec_sql(
        "\\getenv pw VPSCP_PW\n"
        f"CREATE ROLE {user_q} WITH LOGIN PASSWORD :'pw';\n"
        f"CREATE DATABASE {db_q};\n",
        database="postgres",
        secrets={"VPSCP_PW": password},
    )
    psql.exec_sql(
        """
CREATE TABLE legacy_t(id int);
CREATE VIEW legacy_v AS SELECT id FROM legacy_t;
CREATE FUNCTION legacy_f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
""".strip(),
        database=db_name,
    )


def test_create_database_and_verify_password(it_env):
    _settings, psql, state, _password = it_env
    db_name = "it_create"
    db_user = "it_create_user"
    drop_db_and_role(psql, db_name=db_name, db_user=db_user)
    clear_attachment(state, db_name)
    try:
        app_password = create_database(
            psql,
            state,
            slug="itcreate",
            db_name=db_name,
            db_user=db_user,
        )
        assert verify_password(psql, db_user=db_user, password=app_password, db_name=db_name)
        assert not verify_password(
            psql, db_user=db_user, password="wrong-password-value", db_name=db_name
        )
    finally:
        clear_attachment(state, db_name)
        drop_db_and_role(psql, db_name=db_name, db_user=db_user)


def test_database_isolation_between_app_users(it_env):
    settings, psql, state, _password = it_env
    drop_db_and_role(psql, db_name="it_a", db_user="it_a_user")
    drop_db_and_role(psql, db_name="it_b", db_user="it_b_user")
    clear_attachment(state, "it_a")
    clear_attachment(state, "it_b")
    try:
        pw_a = create_database(psql, state, slug="ita", db_name="it_a", db_user="it_a_user")
        create_database(psql, state, slug="itb", db_name="it_b", db_user="it_b_user")
        container = settings.pg_container
        result = run_command(
            [
                "docker",
                "exec",
                "-e",
                "PGPASSWORD",
                container,
                "psql",
                "-h",
                container,
                "-U",
                "it_a_user",
                "-d",
                "it_b",
                "-c",
                "SELECT 1",
            ],
            extra_env={"PGPASSWORD": pw_a},
            check=False,
        )
        assert result.returncode != 0
        assert "permission denied for database" in result.stderr.lower()
    finally:
        clear_attachment(state, "it_a")
        clear_attachment(state, "it_b")
        drop_db_and_role(psql, db_name="it_a", db_user="it_a_user")
        drop_db_and_role(psql, db_name="it_b", db_user="it_b_user")


def test_app_user_can_create_table_and_sequence(it_env):
    settings, psql, state, _password = it_env
    db_name = "it_appddl"
    db_user = "it_appddl_user"
    drop_db_and_role(psql, db_name=db_name, db_user=db_user)
    clear_attachment(state, db_name)
    try:
        app_password = create_database(
            psql, state, slug="itappddl", db_name=db_name, db_user=db_user
        )
        container = settings.pg_container
        run_command(
            [
                "docker",
                "exec",
                "-e",
                "PGPASSWORD",
                container,
                "psql",
                "-h",
                container,
                "-U",
                db_user,
                "-d",
                db_name,
                "-c",
                "CREATE TABLE t(id serial primary key);",
            ],
            extra_env={"PGPASSWORD": app_password},
            check=True,
        )
        owners = _object_owners(psql, db_name, ("t", "t_id_seq"))
        assert owners["t"] == db_user
        assert owners["t_id_seq"] == db_user
    finally:
        clear_attachment(state, db_name)
        drop_db_and_role(psql, db_name=db_name, db_user=db_user)


def test_adopt_rotate_transfers_ownership_not_reassign_owned(it_env):
    _settings, psql, state, _password = it_env
    legacy_db = "it_legacy"
    legacy_user = "it_legacy_user"
    control_db = "it_control"
    legacy_password = "legacy-known-password-0123456789ab"
    drop_db_and_role(psql, db_name=legacy_db, db_user=legacy_user)
    drop_db_and_role(psql, db_name=control_db, db_user="it_control_user")
    clear_attachment(state, legacy_db)
    try:
        _legacy_cluster_setup(
            psql, db_name=legacy_db, db_user=legacy_user, password=legacy_password
        )
        control_q = quote_ident(control_db)
        psql.exec_sql(f"CREATE DATABASE {control_q};\n", database="postgres")
        admin = psql.admin_user()
        assert _database_owner(psql, control_db) == admin

        adopt_database(
            psql,
            state,
            slug="itlegacy",
            db_name=legacy_db,
            db_user=legacy_user,
            password_mode="rotate",
            password=None,
        )

        owners = _object_owners(psql, legacy_db, ("legacy_t", "legacy_v"))
        assert owners["legacy_t"] == legacy_user
        assert owners["legacy_v"] == legacy_user
        assert _function_owner(psql, legacy_db, "legacy_f") == legacy_user
        assert _database_owner(psql, legacy_db) == legacy_user
        assert _database_owner(psql, control_db) == admin
    finally:
        clear_attachment(state, legacy_db)
        drop_db_and_role(psql, db_name=legacy_db, db_user=legacy_user)
        psql.exec_sql(
            f"DROP DATABASE IF EXISTS {quote_ident(control_db)};\n",
            database="postgres",
            on_error_stop=False,
        )


def test_adopt_keep_mode_wrong_password_raises(it_env):
    _settings, psql, state, _password = it_env
    legacy_db = "it_keepfail"
    legacy_user = "it_keepfail_user"
    legacy_password = "keepfail-password-0123456789abcd"
    drop_db_and_role(psql, db_name=legacy_db, db_user=legacy_user)
    clear_attachment(state, legacy_db)
    try:
        _legacy_cluster_setup(
            psql, db_name=legacy_db, db_user=legacy_user, password=legacy_password
        )
        with pytest.raises(ValueError, match="password verification failed"):
            adopt_database(
                psql,
                state,
                slug="itkeepfail",
                db_name=legacy_db,
                db_user=legacy_user,
                password_mode="keep",
                password="not-the-right-password",
            )
        with state.connect() as conn:
            assert (
                conn.execute(
                    "SELECT 1 FROM db_attachment WHERE db_name = ?", (legacy_db,)
                ).fetchone()
                is None
            )
    finally:
        clear_attachment(state, legacy_db)
        drop_db_and_role(psql, db_name=legacy_db, db_user=legacy_user)


def test_rotate_password_invalidates_old_password(it_env):
    _settings, psql, state, _password = it_env
    db_name = "it_rotate"
    db_user = "it_rotate_user"
    drop_db_and_role(psql, db_name=db_name, db_user=db_user)
    clear_attachment(state, db_name)
    try:
        old_password = create_database(
            psql, state, slug="itrotate", db_name=db_name, db_user=db_user
        )
        new_password = rotate_password(psql, db_user=db_user)
        assert not verify_password(psql, db_user=db_user, password=old_password, db_name=db_name)
        assert verify_password(psql, db_user=db_user, password=new_password, db_name=db_name)
    finally:
        clear_attachment(state, db_name)
        drop_db_and_role(psql, db_name=db_name, db_user=db_user)


def test_dump_project_produces_pg_restore_listable_file(it_env):
    settings, psql, state, _password = it_env
    db_name = "it_dump"
    db_user = "it_dump_user"
    drop_db_and_role(psql, db_name=db_name, db_user=db_user)
    clear_attachment(state, db_name)
    try:
        create_database(psql, state, slug="itdump", db_name=db_name, db_user=db_user)
        info = dump_project(settings, psql, run_command, state, slug="itdump")
        path = settings.dumps_dir / "itdump" / info.name
        assert path.is_file()
        assert path.stat().st_size > 0
        listing = run_command(
            [
                "docker",
                "exec",
                "-i",
                settings.pg_container,
                "pg_restore",
                "--list",
            ],
            input_data=path.read_bytes(),
            check=True,
        )
        assert listing.stdout.strip()
    finally:
        clear_attachment(state, db_name)
        drop_db_and_role(psql, db_name=db_name, db_user=db_user)


def test_restore_cluster_restores_database_and_admin_password(it_env):
    settings, psql, state, admin_password = it_env
    db_name = "it_restore"
    db_user = "it_restore_user"
    app_password = "restore-app-password-0123456789ab"
    drop_db_and_role(psql, db_name=db_name, db_user=db_user)
    clear_attachment(state, db_name)
    dump_path = settings.restore_dir / "it-restore-seed.sql.gz"
    try:
        user_q = quote_ident(db_user)
        db_q = quote_ident(db_name)
        psql.exec_sql(
            "\\getenv pw VPSCP_PW\n"
            f"CREATE ROLE {user_q} WITH LOGIN PASSWORD :'pw';\n"
            f"CREATE DATABASE {db_q};\n",
            database="postgres",
            secrets={"VPSCP_PW": app_password},
        )
        psql.exec_sql(
            "CREATE TABLE seed_row(id int); INSERT INTO seed_row VALUES (42);",
            database=db_name,
        )
        admin = psql.admin_user()
        run_command.stream_to_gzip_file(
            [
                "docker",
                "exec",
                settings.pg_container,
                "pg_dumpall",
                "-U",
                admin,
            ],
            dump_path,
            120,
        )
        psql.exec_sql(
            f"DROP DATABASE {db_q} WITH (FORCE);\nDROP ROLE {user_q};\n",
            database="postgres",
        )
        rows = psql.query_rows(
            f"SELECT 1 FROM pg_database WHERE datname = '{db_name}';",
            database="postgres",
        )
        assert not rows

        store = UploadStore(settings)
        upload_id = _complete_upload(store, dump_path.read_bytes())
        result = restore_cluster(
            _ctx(),
            settings=settings,
            psql=psql,
            runner=run_command,
            db=state,
            upload_id=upload_id,
        )
        assert result["error_count"] == 0

        count_rows = psql.query_rows(
            "SELECT id FROM seed_row;",
            database=db_name,
        )
        assert count_rows == [["42"]]
        assert verify_password(
            psql, db_user=psql.admin_user(), password=admin_password, db_name="postgres"
        )
    finally:
        clear_attachment(state, db_name)
        drop_db_and_role(psql, db_name=db_name, db_user=db_user)
        dump_path.unlink(missing_ok=True)
