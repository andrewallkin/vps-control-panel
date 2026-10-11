import json
import threading

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent.compose_ops import (
    compose_base_argv,
    compose_project_cwd,
    get_compose_services,
    parse_compose_ps,
    run_compose_job,
)
from vpscp_agent.config import load_settings
from vpscp_agent.jobs import JobManager
from vpscp_agent.main import create_app
from vpscp_agent.projects import register_project
from vpscp_agent.state import StateDB
from vpscp_agent.validation import safe_project_path

DEFAULT_BODY = {
    "slug": "budget-hq",
    "repo_url": "git@github.com:owner/repo.git",
    "branch": "main",
    "compose_file": "docker-compose.yml",
    "deploy_mode": "build",
}

COMPOSE_WITH_POSTGRES = """\
services:
  web:
    image: ${DOCKER_IMAGE_WEB:-nginx:alpine}
    networks:
      - postgres-net
networks:
  postgres-net:
    external: true
"""

COMPOSE_NO_POSTGRES = """\
services:
  web:
    image: nginx:alpine
networks:
  default:
    driver: bridge
"""

CONFIG_JSON = json.dumps(
    {
        "services": {
            "web": {
                "image": "nginx:alpine",
                "networks": ["postgres-net"],
            }
        },
        "networks": {"postgres-net": {}},
    }
)


@pytest.fixture
def compose_setup(tmp_path):
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
    (project_dir / ".env").write_text("X=1\n")
    return settings, db, runner, slug, project_dir


def _expected_base(slug: str, compose_file: str) -> list[str]:
    return [
        "docker",
        "compose",
        "-p",
        slug,
        "-f",
        compose_file,
        "--env-file",
        ".env",
    ]


def test_compose_base_argv_and_cwd(compose_setup):
    settings, _db, _runner, slug, project_dir = compose_setup
    compose_file = "docker-compose.yml"
    assert compose_project_cwd(settings, slug) == project_dir
    assert compose_base_argv(slug, compose_file) == _expected_base(slug, compose_file)


@pytest.mark.parametrize(
    "extra,expected_tail",
    [
        (["config", "--format", "json"], ["config", "--format", "json"]),
        (["ps", "--format", "json"], ["ps", "--format", "json"]),
        (["pull"], ["pull"]),
        (["up", "-d", "--remove-orphans"], ["up", "-d", "--remove-orphans"]),
        (
            ["run", "--rm", "--no-deps", "web", "alembic", "upgrade", "head"],
            ["run", "--rm", "--no-deps", "web", "alembic", "upgrade", "head"],
        ),
    ],
)
def test_compose_invocation_argv(compose_setup, extra, expected_tail):
    settings, db, runner, slug, project_dir = compose_setup
    (project_dir / "docker-compose.yml").write_text("services: {}\n")
    runner.on("docker compose", stdout="{}" if "config" in extra else "[]")

    if extra[0] == "config":
        get_compose_services(settings, db, runner, slug)
    elif extra[0] == "ps":
        from vpscp_agent.compose_ops import compose_ps

        compose_ps(settings, db, runner, slug)
    elif extra[0] in ("pull", "up", "run"):
        run_compose_job(settings, db, runner, slug, extra)

    assert len(runner.calls) == 1
    call = runner.calls[0]
    assert call["cwd"] == project_dir
    assert call["args"] == _expected_base(slug, "docker-compose.yml") + expected_tail
    joined = " ".join(call["args"])
    assert "sh" not in joined.split()
    assert "bash" not in joined.split()


def test_get_compose_services_image_var_and_warning_null(compose_setup):
    settings, db, runner, slug, project_dir = compose_setup
    (project_dir / "docker-compose.yml").write_text(COMPOSE_WITH_POSTGRES)
    runner.on("config --format json", stdout=CONFIG_JSON)

    result = get_compose_services(settings, db, runner, slug)
    assert result["warning"] is None
    assert result["networks"] == ["postgres-net"]
    assert len(result["services"]) == 1
    svc = result["services"][0]
    assert svc["name"] == "web"
    assert svc["image"] == "nginx:alpine"
    assert svc["image_var"] == "DOCKER_IMAGE_WEB"


def test_get_compose_services_postgres_net_warning(compose_setup):
    settings, db, runner, slug, project_dir = compose_setup
    (project_dir / "docker-compose.yml").write_text(COMPOSE_NO_POSTGRES)
    config = json.dumps(
        {
            "services": {"web": {"image": "nginx:alpine", "networks": ["default"]}},
            "networks": {"default": {}},
        }
    )
    runner.on("config --format json", stdout=config)

    result = get_compose_services(settings, db, runner, slug)
    assert result["warning"] == "compose file does not join postgres-net"


def test_parse_compose_ps_json_array():
    raw = json.dumps(
        [
            {
                "Service": "web",
                "State": "running",
                "Health": "healthy",
                "Image": "nginx:alpine",
                "Created": "2024-01-01T00:00:00Z",
            }
        ]
    )
    out = parse_compose_ps(raw)
    assert out == [
        {
            "service": "web",
            "state": "running",
            "health": "healthy",
            "image": "nginx:alpine",
            "started_at": "2024-01-01T00:00:00Z",
        }
    ]


def test_parse_compose_ps_json_lines():
    lines = [
        json.dumps(
            {
                "Service": "api",
                "Status": "exited",
                "Image": "api:1",
            }
        ),
        json.dumps(
            {
                "Service": "web",
                "State": "running",
                "Image": "web:2",
            }
        ),
    ]
    out = parse_compose_ps("\n".join(lines) + "\n\n")
    assert len(out) == 2
    assert out[0]["service"] == "api" and out[0]["state"] == "exited" and out[0]["health"] == ""
    assert out[1]["service"] == "web" and out[1]["state"] == "running"


_fake_popen_instances: list["FakePopen"] = []


class FakePopen:
    def __init__(self, *args, **kwargs):
        _fake_popen_instances.append(self)
        self.args = args
        self.kwargs = kwargs
        self.stdout = _FakeStdout(["line-one\n", "line-two\n"])
        self._killed = False

    def kill(self):
        self._killed = True

    def wait(self):
        return 0


class _FakeStdout:
    def __init__(self, chunks: list[str]):
        self._chunks = list(chunks)
        self._idx = 0

    def fileno(self):
        return 3

    def readline(self):
        if self._idx < len(self._chunks):
            line = self._chunks[self._idx]
            self._idx += 1
            return line
        return ""


@pytest.fixture
def logs_client(tmp_path):
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
    app = create_app(settings, runner=runner)

    def fake_popen(*args, **kwargs):
        return FakePopen(*args, **kwargs)

    app.state.compose_popen = fake_popen
    _fake_popen_instances.clear()
    with TestClient(app) as client:
        client.post("/v1/projects", json=DEFAULT_BODY)
        slug = DEFAULT_BODY["slug"]
        project_dir = safe_project_path(settings.apps_dir, slug)
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "docker-compose.yml").write_text("services: {}\n")
        (project_dir / ".env").write_text("K=1\n")
        yield client, settings, slug


def test_compose_logs_sse_and_kill_on_close(logs_client, monkeypatch):
    client, _settings, slug = logs_client

    import select

    def fake_select(rlist, *_a, **_k):
        for fd in rlist:
            if fd == 3:
                return ([3], [], [])
        return ([], [], [])

    monkeypatch.setattr(select, "select", fake_select)

    with client.stream("GET", f"/v1/projects/{slug}/compose/logs", params={"follow": "0"}) as resp:
        assert resp.status_code == 200
        body = "".join(resp.iter_text())
    assert "data: line-one" in body
    assert "data: line-two" in body
    assert _fake_popen_instances
    assert _fake_popen_instances[-1]._killed


def test_restart_409_when_deploy_lock_held(tmp_path):
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
        (project_dir / "docker-compose.yml").write_text("services: {}\n")
        (project_dir / ".env").write_text("K=1\n")

        jobs: JobManager = client.app.state.jobs
        gate = threading.Event()

        def block(_ctx):
            gate.wait(timeout=10)

        jobs.start("compose.pull", {"slug": slug}, block, lock_key=f"deploy:{slug}")
        resp = client.post(f"/v1/projects/{slug}/compose/restart")
        assert resp.status_code == 409
        gate.set()
