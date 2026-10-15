import json
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent.config import load_settings
from vpscp_agent.deploy import DeployFailed, deploy_project
from vpscp_agent.envfile import read_env
from vpscp_agent.hostnames import allocate_port
from vpscp_agent.jobs import Job, JobContext, JobManager
from vpscp_agent.main import create_app
from vpscp_agent.projects import register_project
from vpscp_agent.state import StateDB
from vpscp_agent.validation import safe_project_path

DEFAULT_BODY = {
    "slug": "budget-hq",
    "repo_url": "https://github.com/owner/repo.git",
    "branch": "main",
    "compose_file": "docker-compose.yml",
    "deploy_mode": "image",
}

COMMIT = "abc1234"


@pytest.fixture
def deploy_setup(tmp_path):
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )
    db = StateDB(settings.state_db_path)
    db.migrate()
    runner = FakeRunner()
    register_project(db, settings, **DEFAULT_BODY)
    slug = DEFAULT_BODY["slug"]
    project_dir = safe_project_path(settings.apps_dir, slug)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / ".git").mkdir()
    (project_dir / "docker-compose.yml").write_text("services: {}\n")
    (project_dir / ".env").write_text("X=1\n")
    return settings, db, runner, slug, project_dir


def _git_ok(runner: FakeRunner, commit: str = COMMIT) -> None:
    runner.on("git fetch", returncode=0)
    runner.on("git reset", returncode=0)
    runner.on("git rev-parse", stdout=f"{commit}\n", returncode=0)


def _compose_ok(runner: FakeRunner) -> None:
    runner.on("docker compose", returncode=0)


def _ctx(db: StateDB) -> JobContext:
    job = Job(kind="test", params={})
    JobManager(db)._jobs[job.id] = job
    return JobContext(job)


def _env_get(project_dir: Path, key: str) -> str | None:
    return read_env(project_dir / ".env").get(key)


def _run_deploy(
    deploy_setup,
    *,
    tags=None,
    mode="image",
    db_flag=False,
    migration=None,
    health_url=None,
    probe=None,
    sleeper=None,
    now=None,
):
    settings, db, runner, slug, _project_dir = deploy_setup
    from vpscp_agent.pg import Psql

    psql = Psql(settings, runner)
    kwargs = {
        "tags": tags if tags is not None else {"DOCKER_IMAGE_WEB": "backend-main-abc1234"},
        "mode": mode,
        "db_flag": db_flag,
        "migration": migration,
        "health_url": health_url,
    }
    if probe is not None:
        kwargs["probe"] = probe
    if sleeper is not None:
        kwargs["sleeper"] = sleeper
    if now is not None:
        kwargs["now"] = now
    return deploy_project(
        _ctx(db),
        settings,
        db,
        runner,
        psql,
        slug,
        **kwargs,
    )


def test_deploy_with_migration_refused_while_restore_locked(settings):
    """A migrate step against a half-loaded cluster is the dangerous overlap:
    deploy must refuse while the cluster restore holds the postgres lock."""
    from fastapi.testclient import TestClient

    from tests.fakes import FakeRunner
    from vpscp_agent.main import create_app
    from vpscp_agent.state import StateDB

    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()

    with TestClient(create_app(settings, runner=runner)) as client:
        mgr = client.app.state.jobs
        gate = threading.Event()
        mgr.start("db.restore_cluster", {}, lambda _ctx: gate.wait(timeout=30), lock_key="postgres")
        try:
            resp = client.post(
                "/v1/projects/myapp/deploy",
                json={
                    "mode": "build",
                    "tags": {},
                    "db": False,
                    "migration": {"service": "web", "command": "alembic upgrade head"},
                },
            )
            assert resp.status_code == 409
        finally:
            gate.set()


def test_git_fetch_failure_failed_before_switch_no_tags_written(deploy_setup):
    _, _, runner, _, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old-tag\n")
    runner.on("git fetch", returncode=1, stderr="fetch failed")

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(deploy_setup, tags={"DOCKER_IMAGE_WEB": "new-tag"})
    assert "failed_before_switch" in str(exc_info.value)
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "old-tag"
    assert _env_get(project_dir, "DOCKER_IMAGE_API") is None


def test_compose_pull_failure_restores_tags(deploy_setup):
    _, _, runner, _, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old-tag\n")
    _git_ok(runner)

    def compose_handler(args):
        joined = " ".join(args)
        return "pull" in joined and "run" not in joined

    runner.responses.append(
        (
            compose_handler,
            __import__("vpscp_agent.commands", fromlist=["CommandResult"]).CommandResult(
                1, "", "pull failed"
            ),
        )
    )
    runner.on("docker compose", returncode=0)

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(
            deploy_setup,
            tags={"DOCKER_IMAGE_WEB": "new-tag", "DOCKER_IMAGE_API": "api-v1"},
        )
    assert "failed_before_switch" in str(exc_info.value)
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "old-tag"
    assert _env_get(project_dir, "DOCKER_IMAGE_API") is None


def test_dump_failure_restores_tags(deploy_setup, monkeypatch):
    _, _, runner, _, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old-tag\n")
    _git_ok(runner)
    _compose_ok(runner)

    def boom(*_a, **_k):
        raise RuntimeError("dump boom")

    monkeypatch.setattr("vpscp_agent.deploy.dumps.dump_project", boom)

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(deploy_setup, tags={"DOCKER_IMAGE_WEB": "new-tag"}, db_flag=True)
    assert "failed_before_switch" in str(exc_info.value)
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "old-tag"


def test_migrate_failure_restores_tags(deploy_setup):
    _, _, runner, _, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old-tag\n")
    _git_ok(runner)

    def compose_handler(args):
        joined = " ".join(args)
        if " pull" in joined or joined.endswith(" pull"):
            return True
        if " run " in joined:
            return True
        return "docker compose" in joined

    from vpscp_agent.commands import CommandResult

    def response(args):
        joined = " ".join(args)
        if " run " in joined:
            return CommandResult(1, "", "migrate failed")
        return CommandResult(0, "", "")

    runner.responses.append((compose_handler, response))

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(
            deploy_setup,
            tags={"DOCKER_IMAGE_WEB": "new-tag"},
            migration={"service": "web", "command": "alembic upgrade head"},
        )
    assert "failed_before_switch" in str(exc_info.value)
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "old-tag"


def test_up_failure_failed_after_switch_keeps_tags(deploy_setup):
    _, _, runner, _, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old-tag\n")
    _git_ok(runner)
    runner.on(
        lambda args: args[-3:] == ["up", "-d", "--remove-orphans"],
        returncode=1,
        stderr="up failed",
    )
    runner.on("docker compose", returncode=0)

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(deploy_setup, tags={"DOCKER_IMAGE_WEB": "new-tag"})
    assert "failed_after_switch" in str(exc_info.value)
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "new-tag"


def _compose_ps_response(runner: FakeRunner, services: list[dict]) -> None:
    runner.on(
        lambda args: args[-3:] == ["ps", "--format", "json"],
        stdout=json.dumps(services),
        returncode=0,
    )


def _inspect_error(runner: FakeRunner, container: str, message: str) -> None:
    runner.on(
        lambda args: "inspect" in args and container in args,
        stdout=f"{message}\n",
        returncode=0,
    )


def test_created_container_after_up_fails_with_inspect_error(deploy_setup):
    _, _, runner, _, _project_dir = deploy_setup
    _compose_ps_response(
        runner,
        [
            {
                "Name": "budget-hq-backend-1",
                "Service": "backend",
                "State": "created",
                "Status": "Created",
                "Health": "",
                "Image": "andrewallkin/budgethq:backend-main-x",
                "CreatedAt": "",
            }
        ],
    )
    _inspect_error(
        runner,
        "budget-hq-backend-1",
        "failed to set up container networking: Bind for 127.0.0.1:8000 failed: port is already allocated",
    )
    _git_ok(runner)
    _compose_ok(runner)

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(deploy_setup)
    message = str(exc_info.value)
    assert "failed_after_switch" in message
    assert "backend" in message
    assert "port is already allocated" in message


def test_exited_container_after_up_fails_with_state_fallback(deploy_setup):
    _, _, runner, _, _project_dir = deploy_setup
    _compose_ps_response(
        runner,
        [
            {
                "Name": "budget-hq-worker-1",
                "Service": "worker",
                "State": "exited",
                "Status": "Exited (1)",
                "Health": "",
                "Image": "img",
                "CreatedAt": "",
            }
        ],
    )
    _inspect_error(runner, "budget-hq-worker-1", "")
    _git_ok(runner)
    _compose_ok(runner)

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(deploy_setup)
    message = str(exc_info.value)
    assert "failed_after_switch" in message
    assert "worker" in message
    assert "exited" in message


def test_running_containers_after_up_pass_check(deploy_setup):
    _, _, runner, _, _project_dir = deploy_setup
    _compose_ps_response(
        runner,
        [
            {
                "Name": "budget-hq-backend-1",
                "Service": "backend",
                "State": "running",
                "Status": "Up",
                "Health": "healthy",
                "Image": "img",
                "CreatedAt": "",
            }
        ],
    )
    _git_ok(runner)
    _compose_ok(runner)

    result = _run_deploy(deploy_setup)
    assert result["status"] == "succeeded"
    inspect_calls = [c for c in runner.calls if "inspect" in c["args"]]
    assert inspect_calls == []


def test_health_failure_failed_after_switch(deploy_setup):
    _, db, runner, slug, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old-tag\n")
    _git_ok(runner)
    _compose_ok(runner)
    allocate_port(db, slug, "APP_PORT", listening_ports=lambda: set())

    sleeper_calls: list[float] = []
    clock = {"t": 0.0}

    def fake_now():
        return clock["t"]

    def fake_sleeper(seconds):
        sleeper_calls.append(seconds)
        clock["t"] += 60.0

    def fake_probe(_url):
        return 500

    with pytest.raises(DeployFailed) as exc_info:
        _run_deploy(
            deploy_setup,
            tags={"DOCKER_IMAGE_WEB": "new-tag"},
            health_url="http://127.0.0.1:10000/health",
            probe=fake_probe,
            sleeper=fake_sleeper,
            now=fake_now,
        )
    assert "failed_after_switch" in str(exc_info.value)
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "new-tag"
    assert 2 in sleeper_calls


def test_success_image_mode_full(deploy_setup, monkeypatch):
    settings, db, runner, slug, _project_dir = deploy_setup
    _git_ok(runner)
    _compose_ok(runner)
    allocate_port(db, slug, "APP_PORT", listening_ports=lambda: set())

    class FakeDump:
        name = "20260101T120000Z.dump"

    monkeypatch.setattr(
        "vpscp_agent.deploy.dumps.dump_project",
        lambda *a, **k: FakeDump(),
    )

    ctx = _ctx(db)
    from vpscp_agent.pg import Psql

    result = deploy_project(
        ctx,
        settings,
        db,
        runner,
        Psql(settings, runner),
        slug,
        tags={"DOCKER_IMAGE_WEB": "backend-main-abc1234"},
        mode="image",
        db_flag=True,
        migration={"service": "web", "command": "alembic upgrade head"},
        health_url="http://127.0.0.1:10000/health",
        probe=lambda _u: 200,
        sleeper=lambda _s: None,
        now=lambda: 0.0,
    )

    assert result["status"] == "succeeded"
    assert result["commit"] == COMMIT
    assert result["dump"] == FakeDump.name
    lines = ctx._job.lines
    assert "==> step 1: git pull" in lines
    assert "==> step 3: compose pull" in lines
    assert "==> step 6: compose up" in lines

    migrate_calls = [c for c in runner.calls if " run " in " ".join(c["args"])]
    assert migrate_calls
    argv = migrate_calls[0]["args"]
    assert "run" in argv
    assert "--rm" in argv
    assert "--no-deps" in argv
    assert "alembic" in argv
    assert "upgrade" in argv
    assert "head" in argv
    assert "sh" not in argv


def test_build_mode_no_pull_unchanged_env(deploy_setup):
    _, _, runner, _, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=keep-me\n")
    _git_ok(runner)
    _compose_ok(runner)

    result = _run_deploy(deploy_setup, tags={}, mode="build")
    assert result["status"] == "succeeded"
    assert _env_get(project_dir, "DOCKER_IMAGE_WEB") == "keep-me"
    joined_all = " ".join(" ".join(c["args"]) for c in runner.calls)
    assert " build" in joined_all or joined_all.endswith("build")
    assert " pull" not in joined_all.split()


def test_deploy_409_when_postgres_locked(tmp_path):
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        client.post("/v1/projects", json=DEFAULT_BODY)
        slug = DEFAULT_BODY["slug"]
        project_dir = safe_project_path(settings.apps_dir, slug)
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / ".git").mkdir()
        (project_dir / "docker-compose.yml").write_text("services: {}\n")
        (project_dir / ".env").write_text("X=1\n")

        jobs: JobManager = client.app.state.jobs
        gate = threading.Event()

        def block(_ctx):
            gate.wait(timeout=10)

        jobs.start("postgres.block", {}, block, lock_key="postgres")
        resp = client.post(
            f"/v1/projects/{slug}/deploy",
            json={
                "tags": {"DOCKER_IMAGE_WEB": "v1"},
                "mode": "image",
                "db": True,
            },
        )
        assert resp.status_code == 409
        deploy_jobs = [j for j in jobs.list() if j.kind == "project.deploy"]
        assert not deploy_jobs
        gate.set()


def test_health_url_unallocated_port_400(deploy_setup):
    settings, _, runner, slug, _project_dir = deploy_setup
    with TestClient(create_app(settings, runner=runner)) as client:
        resp = client.post(
            f"/v1/projects/{slug}/deploy",
            json={
                "tags": {"DOCKER_IMAGE_WEB": "v1"},
                "mode": "image",
                "db": False,
                "health_url": "http://127.0.0.1:10000/health",
            },
        )
        assert resp.status_code == 400


def test_deploy_job_via_http(deploy_setup):
    settings, _, runner, slug, _project_dir = deploy_setup
    _git_ok(runner)
    _compose_ok(runner)
    with TestClient(create_app(settings, runner=runner)) as client:
        resp = client.post(
            f"/v1/projects/{slug}/deploy",
            json={
                "tags": {"DOCKER_IMAGE_WEB": "v1"},
                "mode": "image",
                "db": False,
            },
        )
        assert resp.status_code == 202
        job_id = resp.json()["job_id"]
        job = client.app.state.jobs.wait(job_id, timeout=5)
        assert job.status == "succeeded"


def test_git_fetch_failure_job_failed(deploy_setup):
    settings, _, runner, slug, project_dir = deploy_setup
    (project_dir / ".env").write_text("DOCKER_IMAGE_WEB=old\n")
    with TestClient(create_app(settings, runner=runner)) as client:
        runner.on("git fetch", returncode=1, stderr="nope")
        resp = client.post(
            f"/v1/projects/{slug}/deploy",
            json={"tags": {"DOCKER_IMAGE_WEB": "new"}, "mode": "image", "db": False},
        )
        job_id = resp.json()["job_id"]
        job = client.app.state.jobs.wait(job_id, timeout=5)
        assert job.status == "failed"
        assert job.error is not None
        assert "failed_before_switch" in job.error
