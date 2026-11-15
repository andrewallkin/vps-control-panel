import json
from datetime import UTC, datetime

import httpx
import pytest
from conftest import login

import vpscp_panel.db as db_module
from vpscp_panel.models import Deploy, Domain, ProjectHostname, ProjectRoute
from vpscp_panel.project_creation import hostname_fqdn, initial_creation_state


@pytest.fixture
def db_session(panel_settings):
    from vpscp_panel.db import init_db, run_migrations

    run_migrations(panel_settings)
    init_db(panel_settings)
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as session:
        yield session


def _ready_project(db, *, slug: str = "myapp") -> None:
    if db.get(Domain, "example.com") is None:
        db.add(
            Domain(
                name="example.com",
                zone_id="zone-1",
                cert_status="missing",
                cert_expires_at=None,
            )
        )
    state = initial_creation_state()
    state["status"] = "ready"
    for step in state["steps"]:
        step["status"] = "done"
    from vpscp_panel.models import Project

    db.add(
        Project(
            slug=slug,
            display_name="My App",
            repo_url="https://github.com/acme/myapp.git",
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="image",
            docker_hub_repo="acme/myapp",
            database_mode="none",
            db_name=None,
            db_user=None,
            write_database_url=False,
            migration_command=None,
            migration_service=None,
            health_check_url=None,
            user_env="",
            creation_state=json.dumps(state),
            created_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
        )
    )
    db.add(
        ProjectHostname(
            project_slug=slug,
            domain="example.com",
            subdomain="app",
            kind="primary",
        )
    )
    db.add(
        ProjectRoute(
            project_slug=slug,
            path_prefix="/",
            port_env_var="APP_PORT",
        )
    )
    db.commit()


def test_list_projects_includes_overview_fields(
    client_factory, admin_user, frozen_time, db_session
):
    _ready_project(db_session, slug="upapp")
    _ready_project(db_session, slug="draft")
    db_session.add(
        Deploy(
            project_slug="upapp",
            started_at=datetime(2025, 6, 15, 10, 0, 0, tzinfo=UTC),
            finished_at=datetime(2025, 6, 15, 10, 5, 0, tzinfo=UTC),
            status="succeeded",
            tags_json="{}",
            log="",
            trigger="deploy",
            commit="abc123",
        )
    )
    db_session.commit()

    ps_response = {
        "services": [
            {
                "service": "web",
                "state": "running",
                "health": "healthy",
                "name": "upapp-web-1",
            }
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/projects/upapp/compose/ps":
            return httpx.Response(200, json=ps_response)
        if request.url.path == "/v1/projects/draft/compose/ps":
            return httpx.Response(200, json={"services": []})
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    login(client, admin_user, frozen_time)

    response = client.get("/api/projects")
    assert response.status_code == 200, response.text
    rows = {row["slug"]: row for row in response.json()}

    up = rows["upapp"]
    assert up["runtime_status"] == "running"
    assert up["primary_url"] == f"https://{hostname_fqdn('example.com', 'app')}/"
    assert up["last_deploy"] is not None
    assert up["last_deploy"]["id"] > 0
    assert up["last_deploy"]["status"] == "succeeded"

    draft = rows["draft"]
    assert draft["runtime_status"] == "not_deployed"
    assert draft["last_deploy"] is None
