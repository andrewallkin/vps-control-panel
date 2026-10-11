import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vpscp_agent.commands import run_command
from vpscp_agent.config import load_settings
from vpscp_agent.deploy_keys import deploy_key_private_path, deploy_key_public_path
from vpscp_agent.hostnames import allocate_port
from vpscp_agent.main import create_app
from vpscp_agent.projects import register_project
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_repo_url


def _git_base() -> list[str]:
    return ["git", "-c", "user.email=vpscp@test.local", "-c", "user.name=VPSCP Test"]


def _run_git(args: list[str], *, cwd: Path | None = None) -> None:
    run_command(_git_base() + args, cwd=cwd, check=True)


def _seed_bare_repo(bare: Path) -> str:
    """Initialize bare repo on main with seed commit; return initial HEAD sha."""
    work = bare.parent / "seed-work"
    work.mkdir()
    _run_git(["init", "-b", "main"], cwd=work)
    (work / ".env").write_text("FROM_REPO=1\n")
    (work / "data" / "other").parent.mkdir(parents=True)
    (work / "data" / "other").write_text("other\n")
    (work / "README.md").write_text("# test\n")
    (work / "docker-compose.yml").write_text("services: {}\n")
    _run_git(["add", "-A"], cwd=work)
    _run_git(["commit", "-m", "seed"], cwd=work)
    _run_git(["branch", "-M", "main"], cwd=work)
    _run_git(["init", "--bare", "-b", "main", str(bare)])
    _run_git(["remote", "add", "origin", str(bare)], cwd=work)
    _run_git(["push", "-u", "origin", "main"], cwd=work)
    result = run_command(_git_base() + ["rev-parse", "HEAD"], cwd=work, check=True)
    shutil.rmtree(work)
    return result.stdout.strip()


def _push_second_commit(bare: Path) -> str:
    work = bare.parent / "push-work"
    work.mkdir()
    _run_git(["clone", str(bare), str(work)])
    (work / "README.md").write_text("# updated\n")
    _run_git(["add", "README.md"], cwd=work)
    _run_git(["commit", "-m", "second"], cwd=work)
    _run_git(["push", "origin", "main"], cwd=work)
    result = run_command(_git_base() + ["rev-parse", "HEAD"], cwd=work, check=True)
    shutil.rmtree(work)
    return result.stdout.strip()


@pytest.fixture
def git_settings(tmp_path):
    return load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
            "VPSCP_ALLOW_FILE_REPOS": "1",
        }
    )


@pytest.fixture
def bare_repo(tmp_path) -> tuple[Path, str]:
    bare = tmp_path / "remote.git"
    initial = _seed_bare_repo(bare)
    return bare, initial


def test_validate_repo_url_file_repos():
    good = f"file://{(Path('/tmp/repo.git')).as_posix()}"
    assert validate_repo_url(good, allow_file_repos=True) == good
    with pytest.raises(ValueError):
        validate_repo_url("file:///tmp/../etc/passwd", allow_file_repos=True)
    with pytest.raises(ValueError):
        validate_repo_url(good, allow_file_repos=False)


def test_register_rejects_file_url_without_flag(tmp_path, bare_repo):
    bare, _ = bare_repo
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
        }
    )
    db = StateDB(settings.state_db_path)
    db.migrate()
    url = f"file://{bare.resolve().as_posix()}"
    with pytest.raises(ValueError):
        register_project(
            db,
            settings,
            slug="my-app",
            repo_url=url,
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="build",
        )


def test_register_accepts_file_url_with_flag(git_settings, bare_repo, state_db_factory):
    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    record = register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    assert record.repo_url == url


@pytest.fixture
def state_db_factory():
    def _factory(settings):
        db = StateDB(settings.state_db_path)
        db.migrate()
        return db

    return _factory


def _register_file_project(client: TestClient, settings, bare: Path, slug: str = "my-app"):
    url = f"file://{bare.resolve().as_posix()}"
    response = client.post(
        "/v1/projects",
        json={
            "slug": slug,
            "repo_url": url,
            "branch": "main",
            "compose_file": "docker-compose.yml",
            "deploy_mode": "build",
        },
    )
    assert response.status_code == 200, response.text
    return url


def test_clone_preserves_env_and_data(git_settings, bare_repo, state_db_factory):
    bare, initial_sha = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    project_dir = git_settings.apps_dir / "my-app"
    (project_dir / ".env").write_text("KEEP=1\n")
    (project_dir / "data").mkdir(exist_ok=True)
    (project_dir / "data" / "marker").write_text("keep")

    git_env_seen: list[dict[str, str]] = []

    def tracking_runner(args, **kwargs):
        extra = kwargs.get("extra_env")
        if extra and "GIT_SSH_COMMAND" in extra:
            git_env_seen.append(dict(extra))
        return run_command(args, **kwargs)

    with TestClient(create_app(git_settings, runner=tracking_runner)) as client:
        response = client.post("/v1/projects/my-app/clone")
        assert response.status_code == 202
        job_id = response.json()["job_id"]
        job = client.app.state.jobs.wait(job_id, timeout=60)
        assert job.status == "succeeded", job.error
        assert job.result["commit"] == initial_sha
        assert not git_env_seen

    assert (project_dir / ".env").read_text() == "KEEP=1\n"
    assert (project_dir / "data" / "marker").read_text() == "keep"
    assert (project_dir / "README.md").is_file()
    assert (project_dir / ".git").is_dir()
    head = run_command(
        _git_base() + ["rev-parse", "HEAD"], cwd=project_dir, check=True
    ).stdout.strip()
    assert head == initial_sha


def test_clone_moves_repo_env_when_missing(git_settings, bare_repo, state_db_factory):
    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    project_dir = git_settings.apps_dir / "my-app"
    env_path = project_dir / ".env"
    if env_path.exists():
        env_path.unlink()

    with TestClient(create_app(git_settings, runner=run_command)) as client:
        response = client.post("/v1/projects/my-app/clone")
        job_id = response.json()["job_id"]
        job = client.app.state.jobs.wait(job_id, timeout=60)
        assert job.status == "succeeded", job.error

    assert (project_dir / ".env").read_text() == "FROM_REPO=1\n"


def test_pull_updates_commit_keeps_env(git_settings, bare_repo, state_db_factory):
    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    project_dir = git_settings.apps_dir / "my-app"
    (project_dir / ".env").write_text("KEEP=1\n")

    with TestClient(create_app(git_settings, runner=run_command)) as client:
        clone_resp = client.post("/v1/projects/my-app/clone")
        job = client.app.state.jobs.wait(clone_resp.json()["job_id"], timeout=60)
        assert job.status == "succeeded"

        second_sha = _push_second_commit(bare)
        pull_resp = client.post("/v1/projects/my-app/pull")
        assert pull_resp.status_code == 200
        assert pull_resp.json()["commit"] == second_sha

    assert (project_dir / ".env").read_text() == "KEEP=1\n"
    assert (project_dir / "README.md").read_text() == "# updated\n"


def test_pull_before_clone_400(git_settings, bare_repo, state_db_factory):
    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    with TestClient(create_app(git_settings, runner=run_command)) as client:
        response = client.post("/v1/projects/my-app/pull")
    assert response.status_code == 400
    assert "not cloned" in response.json()["detail"].lower()


def test_delete_wrong_confirm_400(git_settings, bare_repo, state_db_factory):
    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    with TestClient(create_app(git_settings, runner=run_command)) as client:
        response = client.request(
            "DELETE",
            "/v1/projects/my-app",
            json={"confirm": "wrong"},
        )
    assert response.status_code == 400
    with db.connect() as conn:
        assert conn.execute("SELECT 1 FROM project WHERE slug = ?", ("my-app",)).fetchone()


def test_delete_success(git_settings, bare_repo, state_db_factory):
    from vpscp_agent.domains import register_domain

    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    slug = "my-app"
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug=slug,
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    project_dir = git_settings.apps_dir / slug
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "docker-compose.yml").write_text("services: {}\n")

    key_dir = git_settings.state_dir / "deploy-keys"
    key_dir.mkdir(parents=True)
    private = deploy_key_private_path(git_settings, slug)
    public = deploy_key_public_path(git_settings, slug)
    subprocess.run(
        ["ssh-keygen", "-t", "ed25519", "-N", "", "-f", str(private)],
        check=True,
        capture_output=True,
    )

    register_domain(db, "example.com", "zone-1")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO hostname (fqdn, site, domain) VALUES (?, ?, ?)",
            ("app.example.com", slug, "example.com"),
        )
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("myappdb", "myapp_user", slug, "2020-01-01T00:00:00+00:00"),
        )
    allocate_port(db, slug, "APP_PORT", listening_ports=lambda: set())

    with TestClient(create_app(git_settings, runner=run_command)) as client:
        response = client.request(
            "DELETE",
            f"/v1/projects/{slug}",
            json={"confirm": slug},
        )
    assert response.status_code == 200
    body = response.json()
    assert "dir" in body["removed"]
    assert "registry" in body["removed"]
    assert isinstance(body["warnings"], list)

    assert not project_dir.exists()
    assert not private.exists()
    assert not public.exists()
    with db.connect() as conn:
        assert conn.execute("SELECT 1 FROM project WHERE slug = ?", (slug,)).fetchone() is None
        assert (
            conn.execute("SELECT 1 FROM db_attachment WHERE slug = ?", (slug,)).fetchone() is None
        )
        assert conn.execute("SELECT 1 FROM hostname WHERE site = ?", (slug,)).fetchone() is None
        assert (
            conn.execute("SELECT 1 FROM port_allocation WHERE owner = ?", (slug,)).fetchone()
            is None
        )


def test_clone_route_returns_job_id(git_settings, bare_repo, state_db_factory):
    bare, _ = bare_repo
    db = state_db_factory(git_settings)
    url = f"file://{bare.resolve().as_posix()}"
    register_project(
        db,
        git_settings,
        slug="my-app",
        repo_url=url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    with TestClient(create_app(git_settings, runner=run_command)) as client:
        response = client.post("/v1/projects/my-app/clone")
        assert response.status_code == 202
        assert "job_id" in response.json()
        job = client.app.state.jobs.wait(response.json()["job_id"], timeout=60)
        assert job.status == "succeeded"
