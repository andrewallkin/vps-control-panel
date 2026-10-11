import json
import os
import shutil
import stat
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.commands import run_command
from vpscp_agent.config import Settings, load_settings
from vpscp_agent.db_ops import ConflictError, NotFoundError
from vpscp_agent.deploy_keys import deploy_key_private_path, ensure_deploy_key
from vpscp_agent.main import create_app
from vpscp_agent.projects import (
    register_project,
    update_project,
)
from vpscp_agent.projects import (
    test_repo_access as check_repo_access,
)
from vpscp_agent.state import StateDB
from vpscp_agent.validation import (
    validate_branch,
    validate_compose_file,
    validate_deploy_mode,
    validate_project_slug,
    validate_repo_url,
)

SSH_OK = "git@github.com:owner/repo.git"
HTTPS_OK = "https://github.com/owner/repo"
HTTPS_OK_GIT = "https://github.com/owner/repo.git"

DEFAULT_BODY = {
    "slug": "budget-hq",
    "repo_url": SSH_OK,
    "branch": "main",
    "compose_file": "docker-compose.yml",
    "deploy_mode": "build",
}


@pytest.fixture
def settings(tmp_path) -> Settings:
    return load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )


@pytest.fixture
def state_db(tmp_path) -> StateDB:
    db = StateDB(tmp_path / "state.db")
    db.migrate()
    return db


@pytest.fixture
def project_client(settings):
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        yield client, runner, settings


@pytest.mark.parametrize(
    "url",
    [
        "git@github.com:MyOrg/my_repo.git",
        "https://github.com/owner/repo",
        "https://github.com/owner/repo.git",
        "git@github.com:a/b.git",
    ],
)
def test_validate_repo_url_accepts(url: str):
    assert validate_repo_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "https://user:token@github.com/owner/repo.git",
        "https://github.com/owner/repo.git?token=abc",
        "git@github.com:owner/repo",
        "git@gitlab.com:owner/repo.git",
        "https://gitlab.com/owner/repo.git",
        "git@github.com:owner/repo.git ",
        "",
    ],
)
def test_validate_repo_url_rejects(url: str):
    with pytest.raises(ValueError):
        validate_repo_url(url)


@pytest.mark.parametrize("branch", ["main", "feature/foo", "release-1.2"])
def test_validate_branch_accepts(branch: str):
    assert validate_branch(branch) == branch


@pytest.mark.parametrize("branch", ["..", "-rf", "", "foo//bar", "../main"])
def test_validate_branch_rejects(branch: str):
    with pytest.raises(ValueError):
        validate_branch(branch)


@pytest.mark.parametrize("slug", ["panel", "vpscp-panel", "vpscp"])
def test_validate_project_slug_rejects_reserved(slug: str):
    with pytest.raises(ValueError):
        validate_project_slug(slug)


def test_validate_project_slug_accepts_normal():
    assert validate_project_slug("budget-hq") == "budget-hq"


def test_validate_compose_file_accepts_relative():
    assert validate_compose_file("docker-compose.yml") == "docker-compose.yml"
    assert validate_compose_file("compose/prod.yml") == "compose/prod.yml"


@pytest.mark.parametrize("path", ["../x", "/abs", "a//b", ".."])
def test_validate_compose_file_rejects(path: str):
    with pytest.raises(ValueError):
        validate_compose_file(path)


def test_validate_deploy_mode():
    assert validate_deploy_mode("image") == "image"
    assert validate_deploy_mode("build") == "build"
    with pytest.raises(ValueError):
        validate_deploy_mode("other")


def test_migration_creates_project_table(tmp_path):
    db = StateDB(tmp_path / "state.db")
    db.migrate()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project'"
        ).fetchone()
    assert row is not None
    assert "slug TEXT PRIMARY KEY" in row["sql"]
    assert "repo_url TEXT NOT NULL" in row["sql"]


def test_register_creates_dirs_mode_0750(settings: Settings, state_db: StateDB):
    record = register_project(
        state_db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    project_dir = settings.apps_dir / "budget-hq"
    data_dir = project_dir / "data"
    assert project_dir.is_dir()
    assert data_dir.is_dir()
    assert stat.S_IMODE(project_dir.stat().st_mode) == 0o750
    assert stat.S_IMODE(data_dir.stat().st_mode) == 0o750
    assert record.slug == "budget-hq"
    assert record.dir_exists is True
    assert record.cloned is False


def test_register_idempotent_keeps_created_at(settings: Settings, state_db: StateDB):
    first = register_project(
        state_db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    second = register_project(
        state_db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    assert second.created_at == first.created_at
    assert second.model_dump() == first.model_dump()


def test_register_conflict_on_different_branch(settings: Settings, state_db: StateDB):
    register_project(
        state_db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    with pytest.raises(ConflictError):
        register_project(
            state_db,
            settings,
            slug="budget-hq",
            repo_url=SSH_OK,
            branch="develop",
            compose_file="docker-compose.yml",
            deploy_mode="build",
        )


def test_update_project_not_found(settings: Settings, state_db: StateDB):
    with pytest.raises(NotFoundError):
        update_project(state_db, settings, "budget-hq", branch="main")


def test_deploy_key_ssh_keygen_argv_and_modes(settings: Settings, state_db: StateDB):
    register_project(
        state_db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    runner = FakeRunner()
    key_path = deploy_key_private_path(settings, "budget-hq")
    pub_path = key_path.with_suffix(key_path.suffix + ".pub")

    def write_keys(args: list[str]) -> bool:
        if args[:2] == ["ssh-keygen", "-t"]:
            key_path.parent.mkdir(parents=True, exist_ok=True)
            os.chmod(key_path.parent, 0o700)
            key_path.write_text("PRIVATE\n")
            pub_path.write_text("ssh-ed25519 AAAAB3NzaC1yc2E vpscp-budget-hq\n")
            return True
        return False

    runner.on(write_keys)

    pub = ensure_deploy_key(settings, state_db, runner, slug="budget-hq")
    assert pub == "ssh-ed25519 AAAAB3NzaC1yc2E vpscp-budget-hq"
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600
    ssh_calls = [c for c in runner.calls if c["args"] and c["args"][0] == "ssh-keygen"]
    assert len(ssh_calls) == 1
    assert ssh_calls[0]["args"] == [
        "ssh-keygen",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "vpscp-budget-hq",
        "-f",
        str(key_path),
    ]

    pub2 = ensure_deploy_key(settings, state_db, runner, slug="budget-hq")
    assert pub2 == pub
    assert len([c for c in runner.calls if c["args"] and c["args"][0] == "ssh-keygen"]) == 1


@pytest.mark.skipif(shutil.which("ssh-keygen") is None, reason="ssh-keygen not on PATH")
def test_deploy_key_real_ssh_keygen(tmp_path):
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )
    db = StateDB(tmp_path / "state.db")
    db.migrate()
    register_project(
        db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    pub = ensure_deploy_key(settings, db, run_command, slug="budget-hq")
    assert pub.startswith("ssh-ed25519 ")
    key_path = deploy_key_private_path(settings, "budget-hq")
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600


def test_post_register_route_and_audit(project_client):
    client, _runner, _settings = project_client
    db = client.app.state.db
    before = len(audit.list_events(db))

    response = client.post("/v1/projects", json=DEFAULT_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["slug"] == "budget-hq"
    assert body["cloned"] is False
    assert len(audit.list_events(db)) == before + 1
    event = audit.list_events(db)[-1]
    assert event.operation == "project.register"
    assert event.params == {
        "slug": "budget-hq",
        "repo_url": SSH_OK,
        "branch": "main",
        "compose_file": "docker-compose.yml",
        "deploy_mode": "build",
    }
    raw = json.dumps(event.params)
    assert "PRIVATE" not in raw
    assert "BEGIN" not in raw


def test_register_conflict_409(project_client):
    client, _runner, _settings = project_client
    client.post("/v1/projects", json=DEFAULT_BODY)
    conflict = {**DEFAULT_BODY, "branch": "other"}
    response = client.post("/v1/projects", json=conflict)
    assert response.status_code == 409


def test_get_list_not_audited(project_client):
    client, _runner, _settings = project_client
    db = client.app.state.db
    client.post("/v1/projects", json=DEFAULT_BODY)
    before = len(audit.list_events(db))

    assert client.get("/v1/projects").status_code == 200
    assert client.get("/v1/projects/budget-hq").status_code == 200
    assert len(audit.list_events(db)) == before


def test_test_access_ssh_env(project_client):
    client, runner, settings = project_client
    client.post("/v1/projects", json=DEFAULT_BODY)
    key_path = deploy_key_private_path(settings, "budget-hq")
    key_path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(key_path.parent, 0o700)
    key_path.write_text("fake-private")
    key_path.with_name(key_path.name + ".pub").write_text("ssh-ed25519 PUBKEY\n")
    os.chmod(key_path, 0o600)

    known = settings.state_dir / "known_hosts"
    known.parent.mkdir(parents=True, exist_ok=True)
    known.write_text("github.com ssh-ed25519 KEY\n")

    runner.on("git", stdout="abc123\trefs/heads/main\n")

    response = client.post("/v1/projects/budget-hq/test-access")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message": "ok"}
    git_calls = [c for c in runner.calls if c["args"][:2] == ["git", "ls-remote"]]
    assert len(git_calls) == 1
    call = git_calls[0]
    assert call["timeout"] == 30
    env = call["extra_env"]
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert "GIT_SSH_COMMAND" in env
    assert "IdentitiesOnly=yes" in env["GIT_SSH_COMMAND"]
    assert "StrictHostKeyChecking=yes" in env["GIT_SSH_COMMAND"]
    assert str(key_path) in env["GIT_SSH_COMMAND"]
    assert str(known) in env["GIT_SSH_COMMAND"]


def test_test_access_https_no_git_ssh(project_client):
    client, runner, _settings = project_client
    body = {**DEFAULT_BODY, "repo_url": HTTPS_OK}
    client.post("/v1/projects", json=body)
    runner.on("git", stdout="deadbeef\trefs/heads/main\n")

    response = client.post("/v1/projects/budget-hq/test-access")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    call = next(c for c in runner.calls if c["args"][:2] == ["git", "ls-remote"])
    assert call["extra_env"].get("GIT_SSH_COMMAND") is None
    assert call["extra_env"]["GIT_TERMINAL_PROMPT"] == "0"


def test_test_access_empty_stdout_branch_not_found(project_client):
    client, runner, _settings = project_client
    client.post("/v1/projects", json={**DEFAULT_BODY, "repo_url": HTTPS_OK})
    runner.on("git", stdout="")

    response = client.post("/v1/projects/budget-hq/test-access")

    assert response.status_code == 200
    assert response.json() == {"ok": False, "message": "branch not found"}


def test_test_access_nonzero_exit_ok_false(project_client):
    client, runner, _settings = project_client
    client.post("/v1/projects", json={**DEFAULT_BODY, "repo_url": HTTPS_OK})
    runner.on("git", stdout="", stderr="fatal: repo missing", returncode=128)

    response = client.post("/v1/projects/budget-hq/test-access")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "fatal" in body["message"]


def test_test_access_missing_deploy_key(project_client):
    client, runner, _settings = project_client
    client.post("/v1/projects", json=DEFAULT_BODY)

    response = client.post("/v1/projects/budget-hq/test-access")

    assert response.status_code == 200
    assert response.json() == {"ok": False, "message": "deploy key is not generated"}
    assert not [c for c in runner.calls if c["args"][:1] == ["git"]]


def test_test_access_known_hosts_fetch_failure(settings: Settings, state_db: StateDB):
    register_project(
        state_db,
        settings,
        slug="budget-hq",
        repo_url=SSH_OK,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    key_path = deploy_key_private_path(settings, "budget-hq")
    key_path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(key_path.parent, 0o700)
    key_path.write_text("fake-private")
    os.chmod(key_path, 0o600)
    runner = FakeRunner()

    request = httpx.Request("GET", "https://api.github.com/meta")
    err = httpx.ConnectError("connection refused", request=request)

    with patch(
        "vpscp_agent.projects.ensure_known_hosts",
        side_effect=err,
    ):
        result = check_repo_access(settings, state_db, runner, slug="budget-hq")

    assert result.ok is False
    assert result.message
    assert not [c for c in runner.calls if c["args"][:1] == ["git"]]


def test_deploy_key_route_public_key_only(project_client):
    client, runner, settings = project_client
    client.post("/v1/projects", json=DEFAULT_BODY)
    key_path = deploy_key_private_path(settings, "budget-hq")

    def write_keys(args: list[str]) -> bool:
        if args and args[0] == "ssh-keygen":
            key_path.parent.mkdir(parents=True, exist_ok=True)
            key_path.write_text("SECRET PRIVATE KEY")
            key_path.with_suffix(key_path.suffix + ".pub").write_text(
                "ssh-ed25519 TESTPUB vpscp-budget-hq\n"
            )
            return True
        return False

    runner.on(write_keys)
    db = client.app.state.db

    response = client.post("/v1/projects/budget-hq/deploy-key")

    assert response.status_code == 200
    assert response.json() == {"public_key": "ssh-ed25519 TESTPUB vpscp-budget-hq"}
    assert "SECRET" not in response.text
    event = audit.list_events(db)[0]
    assert event.operation == "project.deploy_key"
    assert event.params == {"slug": "budget-hq"}


def test_invalid_repo_url_400(project_client):
    client, _runner, _settings = project_client
    bad = {**DEFAULT_BODY, "repo_url": "https://evil.com/x/y.git"}
    response = client.post("/v1/projects", json=bad)
    assert response.status_code == 400
