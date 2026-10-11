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

    runner.on("LIMIT 1", stdout="1\n")
    runner.on("ORDER BY 1", stdout="")
    runner.on("pg_roles", stdout="pgadmin\n")
    runner.set_pipe_through(
        lines=["NOTICE: ok", "ERROR: role exists", "ERROR: skipped"],
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

    dump_args = runner.stream_gzip_calls[0]["args"]
    assert dump_args[:3] == ["docker", "exec", settings.pg_container]
    assert "pg_dumpall" in dump_args
    safety_path = runner.stream_gzip_calls[0]["path"]
    assert safety_path.name.startswith("safety-") and safety_path.name.endswith(".sql.gz")
    assert result["safety_dump"] is not None
    assert result["safety_dump"].endswith(".sql.gz")
    assert result["error_count"] == 2
    assert result["errors"] == ["ERROR: role exists", "ERROR: skipped"]

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
        assert done.status == "succeeded"
