import json

import httpx
import pytest
from conftest import login
from sqlalchemy import select

import vpscp_panel.db as db_module
from vpscp_panel.models import Domain, Project, ProjectService


def _csrf(auth):
    return {"X-CSRF-Token": auth["csrf_token"]}


def _create_body(**overrides):
    body = {
        "slug": "imgapp",
        "display_name": "Image App",
        "repo": "https://github.com/acme/imgapp.git",
        "branch": "main",
        "compose_file": "docker-compose.yml",
        "deploy_mode": "image",
        "docker_hub_repo": "acme/imgapp",
        "database_mode": "none",
        "write_database_url": False,
        "hostnames": [
            {"domain": "example.com", "subdomain": "app", "kind": "primary"},
        ],
        "routes": [{"path_prefix": "/", "port_env_var": "APP_PORT"}],
    }
    body.update(overrides)
    return body


@pytest.fixture
def db_session(panel_settings):
    from vpscp_panel.db import init_db, run_migrations

    run_migrations(panel_settings)
    init_db(panel_settings)
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as session:
        yield session


def test_retry_create_unblocks_stranded_running(
    client_factory, admin_user, frozen_time, db_session
):
    """A creation_state stuck at 'running' with no live task (panel restarted
    mid-creation) must be retryable instead of 409ing forever."""
    from vpscp_panel.models import Project

    db_session.add(
        Project(
            slug="myapp",
            display_name="My App",
            repo_url="git@github.com:me/myapp.git",
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="build",
            docker_hub_repo=None,
            database_mode="none",
            db_name=None,
            db_user=None,
            write_database_url=False,
            migration_command=None,
            migration_service=None,
            health_check_url=None,
            user_env="",
            creation_state=json.dumps({"status": "running", "steps": []}),
            created_at=frozen_time,
        )
    )
    db_session.commit()

    client = client_factory()
    auth = login(client, admin_user, frozen_time)
    resp = client.post(
        "/api/projects/myapp/retry-create",
        headers={"X-CSRF-Token": auth["csrf_token"]},
    )
    assert resp.status_code == 202, resp.text


def test_create_project_persists_docker_hub_repo(
    client_factory, admin_user, frozen_time, db_session
):
    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    db_session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"detail": f"unexpected {request.method} {request.url.path}"}
        )

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        response = client.post(
            "/api/projects",
            json=_create_body(),
            headers=_csrf(auth),
        )

    assert response.status_code == 202, response.text
    project = db_session.get(Project, "imgapp")
    assert project is not None
    assert project.docker_hub_repo == "acme/imgapp"


def test_create_project_rejects_invalid_docker_hub_repo(
    client_factory, admin_user, frozen_time, db_session
):
    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    db_session.commit()

    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        response = client.post(
            "/api/projects",
            json=_create_body(docker_hub_repo="not-a-valid-repo"),
            headers=_csrf(auth),
        )

    assert response.status_code == 400


def test_create_project_persists_services(client_factory, admin_user, frozen_time, db_session):
    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    db_session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"detail": f"unexpected {request.method} {request.url.path}"}
        )

    services = [
        {
            "service_name": "web",
            "image_env_var": "DOCKER_IMAGE_WEB",
            "tag_prefix": "backend",
        }
    ]
    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        response = client.post(
            "/api/projects",
            json=_create_body(services=services),
            headers=_csrf(auth),
        )

    assert response.status_code == 202, response.text
    rows = db_session.scalars(
        select(ProjectService).where(ProjectService.project_slug == "imgapp")
    ).all()
    assert len(rows) == 1
    assert rows[0].service_name == "web"
    assert rows[0].image_env_var == "DOCKER_IMAGE_WEB"
    assert rows[0].tag_prefix == "backend"
    assert rows[0].current_tag is None


def test_create_project_rejects_duplicate_service_names(
    client_factory, admin_user, frozen_time, db_session
):
    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    db_session.commit()

    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        response = client.post(
            "/api/projects",
            json=_create_body(
                services=[
                    {
                        "service_name": "web",
                        "image_env_var": "DOCKER_IMAGE_WEB",
                        "tag_prefix": "web",
                    },
                    {
                        "service_name": "web",
                        "image_env_var": "DOCKER_IMAGE_API",
                        "tag_prefix": "api",
                    },
                ]
            ),
            headers=_csrf(auth),
        )

    assert response.status_code == 422


def test_compose_services_proxy(client_factory, admin_user, frozen_time, db_session):
    from vpscp_panel.project_creation import initial_creation_state

    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    state = initial_creation_state()
    state["status"] = "ready"
    db_session.add(
        Project(
            slug="imgapp",
            display_name="Image App",
            repo_url="https://github.com/acme/imgapp.git",
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="image",
            docker_hub_repo="acme/imgapp",
            database_mode="none",
            db_name=None,
            db_user=None,
            write_database_url=False,
            migration_command=None,
            migration_service=None,
            health_check_url=None,
            user_env=None,
            creation_state=json.dumps(state),
            created_at=frozen_time,
        )
    )
    db_session.commit()

    agent_payload = {
        "services": [{"name": "web", "image": "", "image_var": "DOCKER_IMAGE_WEB"}],
        "networks": [],
        "warning": None,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/projects/imgapp/compose-services":
            return httpx.Response(200, json=agent_payload)
        return httpx.Response(404, json={"detail": "not found"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/projects/imgapp/compose-services")

    assert response.status_code == 200
    assert response.json() == agent_payload


def test_compose_services_404_when_project_missing(
    client_factory, admin_user, frozen_time, db_session
):
    with client_factory() as client:
        login(client, admin_user, frozen_time)
        response = client.get("/api/projects/missing/compose-services")
    assert response.status_code == 404


def test_put_services_replace_and_preserve_current_tag(
    client_factory, admin_user, frozen_time, db_session
):
    from datetime import UTC, datetime

    from vpscp_panel.project_creation import initial_creation_state

    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    state = initial_creation_state()
    state["status"] = "ready"
    db_session.add(
        Project(
            slug="imgapp",
            display_name="Image App",
            repo_url="https://github.com/acme/imgapp.git",
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="image",
            docker_hub_repo="acme/imgapp",
            database_mode="none",
            db_name=None,
            db_user=None,
            write_database_url=False,
            migration_command=None,
            migration_service=None,
            health_check_url=None,
            user_env=None,
            creation_state=json.dumps(state),
            created_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
        )
    )
    db_session.add(
        ProjectService(
            project_slug="imgapp",
            service_name="web",
            image_env_var="DOCKER_IMAGE_WEB",
            tag_prefix="backend",
            current_tag="backend-main-abc",
        )
    )
    db_session.commit()

    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        response = client.put(
            "/api/projects/imgapp/services",
            json={
                "services": [
                    {
                        "service_name": "api",
                        "image_env_var": "DOCKER_IMAGE_WEB",
                        "tag_prefix": "backend",
                    }
                ]
            },
            headers=_csrf(auth),
        )

    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["services"]) == 1
    assert data["services"][0]["service_name"] == "api"
    assert data["services"][0]["current_tag"] == "backend-main-abc"


def _ready_imgapp(db_session, frozen_time):
    from datetime import UTC, datetime

    from vpscp_panel.project_creation import initial_creation_state

    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    state = initial_creation_state()
    state["status"] = "ready"
    db_session.add(
        Project(
            slug="imgapp",
            display_name="Image App",
            repo_url="https://github.com/acme/imgapp.git",
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="image",
            docker_hub_repo="acme/imgapp",
            database_mode="none",
            db_name=None,
            db_user=None,
            write_database_url=False,
            migration_command=None,
            migration_service=None,
            health_check_url=None,
            user_env=None,
            creation_state=json.dumps(state),
            created_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
        )
    )
    db_session.commit()


def test_create_project_accepts_migration_fields(
    client_factory, admin_user, frozen_time, db_session
):
    """Migration service/command must be settable at creation (the wizard
    collects them) instead of being silently None."""
    from vpscp_panel.models import Project as _Project

    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    db_session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.post(
            "/api/projects",
            json={
                "slug": "migapp",
                "display_name": "Mig App",
                "repo": "https://github.com/acme/migapp.git",
                "branch": "main",
                "compose_file": "docker-compose.yml",
                "deploy_mode": "build",
                "database_mode": "none",
                "hostnames": [
                    {"domain": "example.com", "subdomain": "", "kind": "primary"}
                ],
                "routes": [{"path_prefix": "/", "port_env_var": "WEB_PORT"}],
                "migration_service": "backend",
                "migration_command": "bash /app/run_migrations.sh",
            },
            headers=_csrf(auth),
        )
        assert resp.status_code == 202, resp.text

    with db_module.SessionLocal() as session:
        project = session.get(_Project, "migapp")
        assert project.migration_service == "backend"
        assert project.migration_command == "bash /app/run_migrations.sh"


def test_patch_rejects_invalid_migration_command(
    client_factory, admin_user, frozen_time, db_session
):
    _ready_imgapp(db_session, frozen_time)
    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.patch(
            "/api/projects/imgapp",
            json={"migration_command": "   ", "migration_service": "web"},
            headers=_csrf(auth),
        )
    assert resp.status_code == 422


def test_migrate_endpoint_proxies_agent(client_factory, admin_user, frozen_time, db_session):
    """Standalone 'Run migrations' button: panel proxies the agent's
    compose/migrate endpoint with the configured command."""
    _ready_imgapp(db_session, frozen_time)
    with db_module.SessionLocal() as session:
        project = session.get(Project, "imgapp")
        project.migration_service = "web"
        project.migration_command = "bash /app/run_migrations.sh"
        session.commit()

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.url.path, json.loads(request.content.decode())))
        return httpx.Response(202, json={"job_id": "job-mig-1"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.post(
            "/api/projects/imgapp/migrate",
            headers={"X-CSRF-Token": auth["csrf_token"]},
        )
        assert resp.status_code == 202, resp.text
        assert resp.json() == {"job_id": "job-mig-1"}
        assert calls[-1] == (
            "/v1/projects/imgapp/compose/migrate",
            {"service": "web", "command": "bash /app/run_migrations.sh"},
        )


def test_migrate_endpoint_409_when_unconfigured(
    client_factory, admin_user, frozen_time, db_session
):
    _ready_imgapp(db_session, frozen_time)
    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.post(
            "/api/projects/imgapp/migrate",
            headers={"X-CSRF-Token": auth["csrf_token"]},
        )
    assert resp.status_code == 409


def test_put_routing_writes_allocated_ports_to_env(
    client_factory, admin_user, frozen_time, db_session
):
    """Adding a route with a new port env var must write the allocated host
    port into the project .env — nginx proxies to it and compose binds it."""
    _ready_imgapp(db_session, frozen_time)

    env_patches = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/ports/allocate" and request.method == "POST":
            return httpx.Response(200, json={"port": 10001})
        if path == "/v1/projects/imgapp/env" and request.method == "PATCH":
            env_patches.append(json.loads(request.content.decode()))
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/nginx/sites" and request.method == "POST":
            return httpx.Response(200, json={"site_id": "imgapp"})
        if path == "/v1/dns/records/upsert" and request.method == "POST":
            return httpx.Response(200, json={"fqdn": request.url.path})
        return httpx.Response(404, json={"detail": f"unexpected {path}"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        response = client.put(
            "/api/projects/imgapp/routing",
            json={
                "hostnames": [
                    {"domain": "example.com", "subdomain": "", "kind": "primary"}
                ],
                "routes": [
                    {"path_prefix": "/", "port_env_var": "WEB_PORT"},
                ],
            },
            headers=_csrf(auth),
        )
        assert response.status_code == 200, response.text

    assert len(env_patches) == 1
    assert env_patches[0]["set"] == {"WEB_PORT": "10001"}


def test_put_routing_rejects_duplicate_paths(
    client_factory, admin_user, frozen_time, db_session
):
    _ready_imgapp(db_session, frozen_time)

    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        response = client.put(
            "/api/projects/imgapp/routing",
            json={
                "hostnames": [
                    {"domain": "example.com", "subdomain": "", "kind": "primary"}
                ],
                "routes": [
                    {"path_prefix": "/api", "port_env_var": "A_PORT"},
                    {"path_prefix": "/api", "port_env_var": "B_PORT"},
                ],
            },
            headers=_csrf(auth),
        )
    assert response.status_code == 422


def test_put_services_409_when_deploy_running(client_factory, admin_user, frozen_time, db_session):
    from datetime import UTC, datetime

    from vpscp_panel.project_creation import initial_creation_state

    db_session.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    state = initial_creation_state()
    state["status"] = "ready"
    db_session.add(
        Project(
            slug="imgapp",
            display_name="Image App",
            repo_url="https://github.com/acme/imgapp.git",
            branch="main",
            compose_file="docker-compose.yml",
            deploy_mode="image",
            docker_hub_repo="acme/imgapp",
            database_mode="none",
            db_name=None,
            db_user=None,
            write_database_url=False,
            migration_command=None,
            migration_service=None,
            health_check_url=None,
            user_env=None,
            creation_state=json.dumps(state),
            created_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
        )
    )
    db_session.commit()

    with client_factory() as client:
        # The running deploy must be inserted after app startup: a 'running'
        # row present at startup is an orphan and is reconciled to failed.
        from datetime import UTC
        from datetime import datetime as _dt

        from vpscp_panel.models import Deploy as _Deploy

        with db_module.SessionLocal() as session:
            session.add(
                _Deploy(
                    project_slug="imgapp",
                    started_at=_dt(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
                    finished_at=None,
                    status="running",
                    tags_json="{}",
                    log="",
                    trigger="deploy",
                    commit=None,
                )
            )
            session.commit()
        auth = login(client, admin_user, frozen_time)
        response = client.put(
            "/api/projects/imgapp/services",
            json={"services": []},
            headers=_csrf(auth),
        )

    assert response.status_code == 409


def test_put_services_404_when_project_missing(client_factory, admin_user, frozen_time, db_session):
    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        response = client.put(
            "/api/projects/missing/services",
            json={"services": []},
            headers=_csrf(auth),
        )
    assert response.status_code == 404
