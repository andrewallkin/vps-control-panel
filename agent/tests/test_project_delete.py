import pytest

from tests.fakes import FakeRunner
from vpscp_agent.projects import delete_project, register_project
from vpscp_agent.state import StateDB


@pytest.fixture
def delete_env(settings):
    settings.apps_dir.mkdir(parents=True)
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    register_project(
        db,
        settings,
        slug="myapp",
        repo_url="https://github.com/acme/myapp.git",
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode="build",
    )
    return settings, runner, db


def test_delete_project_twice_succeeds(delete_env):
    """Delete must be idempotent: a retry after a partial failure (or a
    double-click) must not 404 and strand the panel rows forever."""
    settings, runner, db = delete_env

    first = delete_project(settings, db, runner, slug="myapp", confirm="myapp")
    assert first is not None

    second = delete_project(settings, db, runner, slug="myapp", confirm="myapp")
    assert second is not None


def test_delete_missing_project_is_noop_success(delete_env):
    """Deleting a project that is already gone agent-side is success, so the
    panel can finish its own cleanup on retry."""
    settings, runner, db = delete_env
    result = delete_project(settings, db, runner, slug="ghost", confirm="ghost")
    assert result is not None


def test_delete_confirm_must_match_slug(delete_env):
    settings, runner, db = delete_env
    with pytest.raises(ValueError):
        delete_project(settings, db, runner, slug="myapp", confirm="nope")
