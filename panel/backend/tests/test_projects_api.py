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


def test_retry_create_rejects_unconfirmed_deploy_key(
    client_factory, admin_user, frozen_time, db_session
):
    from vpscp_panel.project_creation import initial_creation_state

    state = initial_creation_state()
    state["status"] = "awaiting_deploy_key"
    state["public_key"] = "ssh-ed25519 AAAA vpscp-myapp"
    for step in state["steps"]:
        if step["name"] in ("register", "deploy_key"):
            step["status"] = "done"
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
            creation_state=json.dumps(state),
            created_at=frozen_time,
        )
    )
    db_session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/projects/myapp/test-access":
            return httpx.Response(
                200,
                json={"ok": False, "message": "Permission denied (publickey)."},
            )
        return httpx.Response(404, json={"detail": "unexpected"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        response = client.post(
            "/api/projects/myapp/retry-create",
            headers=_csrf(auth),
        )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Permission denied (publickey)."
    project = db_session.get(Project, "myapp")
    assert project is not None
    saved = json.loads(project.creation_state)
    assert saved["status"] == "awaiting_deploy_key"
    assert saved.get("deploy_key_confirmed") is not True


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
                "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
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


def test_delete_retries_and_cleans_rows_when_agent_already_gone(
    client_factory, admin_user, frozen_time, db_session
):
    """Delete after a prior partial delete must complete: agent 404 is treated
    as success and panel rows (incl. secrets) are always removed."""
    from vpscp_panel.models import (
        PortAllocation as _PA,
    )
    from vpscp_panel.models import (
        Project as _Project,
    )
    from vpscp_panel.models import (
        ProjectRoute as _PR,
    )

    _ready_imgapp(db_session, frozen_time)
    with db_module.SessionLocal() as session:
        session.add(_PR(project_slug="imgapp", path_prefix="/", port_env_var="WEB_PORT"))
        session.add(_PA(project_slug="imgapp", env_var="WEB_PORT", host_port=10001))
        session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "project not found"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        # step-up first (delete requires it)
        from datetime import timedelta

        import pyotp

        step_time = frozen_time + timedelta(seconds=31)
        client.app.state.clock = lambda: step_time
        code = pyotp.TOTP(admin_user["totp_secret"]).at(step_time)
        client.post(
            "/api/auth/step-up",
            json={"code": code},
            headers=_csrf(auth),
        )
        resp = client.request(
            "DELETE",
            "/api/projects/imgapp",
            headers=_csrf(auth),
            json={"confirm": "imgapp", "drop_database": False, "remove_dns": False},
        )
    assert resp.status_code == 200, resp.text
    with db_module.SessionLocal() as session:
        assert session.get(_Project, "imgapp") is None
        assert session.query(_PR).count() == 0
        assert session.query(_PA).count() == 0


def test_project_database_rotate_requires_step_up(
    client_factory, admin_user, frozen_time, db_session
):
    """Same action as POST /api/database/rotate (which requires step-up):
    rotating the live role password invalidates running containers'
    credentials — a stray click must not be enough."""
    _ready_imgapp(db_session, frozen_time)
    with db_module.SessionLocal() as session:
        project = session.get(Project, "imgapp")
        project.database_mode = "new"
        project.db_name = "imgapp_db"
        project.db_user = "imgapp_user"
        session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"password": "rotated-secret"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.post(
            "/api/projects/imgapp/database/rotate",
            headers=_csrf(auth),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "step_up_required"


def test_backup_service_account_clear_requires_step_up(
    client_factory, admin_user, frozen_time, db_session
):
    """Setting credentials needs step-up; clearing them must too."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.put(
            "/api/backups/settings",
            json={
                "service_account": None,
                "bucket": "my-bucket",
                "schedule_hours": "0,12",
                "schedule_minute": 0,
                "timezone": "UTC",
                "retention_days": 30,
            },
            headers=_csrf(auth),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "step_up_required"


def test_patch_env_rejects_managed_keys(client_factory, admin_user, frozen_time, db_session):
    """POSTGRES_PASSWORD/POSTGRES_* and DATABASE_URL are written by the panel;
    a PATCH must not be able to clobber them (the EnvEditor lock is UI-only)."""
    _ready_imgapp(db_session, frozen_time)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        for key in ("POSTGRES_PASSWORD", "POSTGRES_HOST", "DATABASE_URL"):
            resp = client.patch(
                "/api/projects/imgapp/env",
                json={"set": {key: "x"}, "unset": []},
                headers=_csrf(auth),
            )
            assert resp.status_code == 400, (key, resp.text)
        resp = client.patch(
            "/api/projects/imgapp/env",
            json={"set": {"POSTGRES_PASSWORD": "x"}, "unset": []},
            headers=_csrf(auth),
        )
        assert "POSTGRES_PASSWORD" in resp.json()["detail"]


def test_put_env_rejects_managed_keys(client_factory, admin_user, frozen_time, db_session):
    _ready_imgapp(db_session, frozen_time)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.put(
            "/api/projects/imgapp/env",
            json={"content": "POSTGRES_PASSWORD=hacked\nAPI_KEY=ok\n"},
            headers=_csrf(auth),
        )
        assert resp.status_code == 400
        assert "POSTGRES_PASSWORD" in resp.json()["detail"]


def test_creation_keeps_user_db_keys_when_panel_writes_none():
    """database_mode=none: the panel writes no POSTGRES_*/DATABASE_URL, so a
    user-supplied DATABASE_URL must be kept, not silently dropped."""
    from vpscp_panel.project_env import build_project_env_content

    content = build_project_env_content(
        user_env="DATABASE_URL=postgresql://x\nAPI_KEY=ok\n",
        database_mode="none",
        db_name=None,
        db_user=None,
        db_password=None,
        write_database_url=False,
        ports={},
    )
    assert "DATABASE_URL=postgresql://x" in content
    assert "API_KEY=ok" in content


def test_creation_still_overwrites_panel_written_keys():
    """When the panel writes the POSTGRES block, its values win over pasted
    ones (the runbook says don't paste them)."""
    from vpscp_panel.project_env import build_project_env_content

    content = build_project_env_content(
        user_env="POSTGRES_PASSWORD=pasted\nAPI_KEY=ok\n",
        database_mode="new",
        db_name="app_db",
        db_user="app_user",
        db_password="generated",
        write_database_url=True,
        ports={},
    )
    assert "POSTGRES_PASSWORD=generated" in content
    assert "POSTGRES_PASSWORD=pasted" not in content
    assert "API_KEY=ok" in content


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


def test_create_project_accepts_route_options(client_factory, admin_user, frozen_time, db_session):
    """Route proxy options (streaming for Strava MCP routes) must be
    accepted at creation and persisted."""
    from vpscp_panel.models import ProjectRoute as _PR

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
                "slug": "optapp",
                "display_name": "Opt App",
                "repo": "https://github.com/acme/optapp.git",
                "branch": "main",
                "compose_file": "docker-compose.yml",
                "deploy_mode": "build",
                "database_mode": "none",
                "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
                "routes": [
                    {
                        "path_prefix": "/mcp",
                        "port_env_var": "MCP_PORT",
                        "streaming": True,
                        "max_body_mb": 64,
                        "read_timeout_s": 600,
                    }
                ],
            },
            headers=_csrf(auth),
        )
        assert resp.status_code == 202, resp.text

    with db_module.SessionLocal() as session:
        route = session.query(_PR).filter_by(project_slug="optapp").one()
        assert route.streaming is True
        assert route.max_body_mb == 64
        assert route.read_timeout_s == 600


def test_create_project_rejects_streaming_and_websocket(
    client_factory, admin_user, frozen_time, db_session
):
    """nginx renders conflicting Connection headers when both are set; the
    combination is invalid."""
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
        resp = client.post(
            "/api/projects",
            json={
                "slug": "badapp",
                "display_name": "Bad App",
                "repo": "https://github.com/acme/badapp.git",
                "branch": "main",
                "compose_file": "docker-compose.yml",
                "deploy_mode": "build",
                "database_mode": "none",
                "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
                "routes": [
                    {
                        "path_prefix": "/",
                        "port_env_var": "WEB_PORT",
                        "streaming": True,
                        "websocket": True,
                    }
                ],
            },
            headers=_csrf(auth),
        )
    assert resp.status_code == 422


def test_routes_reject_managed_key_port_env_var(
    client_factory, admin_user, frozen_time, db_session
):
    """A route whose port_env_var is POSTGRES_PASSWORD would have put_routing
    write {'POSTGRES_PASSWORD': '10001'} over the live DB password via the
    panel's internal env path. Reject the name at the API."""
    _ready_imgapp(db_session, frozen_time)

    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.put(
            "/api/projects/imgapp/routing",
            json={
                "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
                "routes": [
                    {"path_prefix": "/", "port_env_var": "POSTGRES_PASSWORD"},
                ],
            },
            headers=_csrf(auth),
        )
    assert resp.status_code == 422, resp.text


def test_put_routing_upserts_all_current_dns(client_factory, admin_user, frozen_time, db_session):
    """A Cloudflare outage during the first upsert must be recoverable:
    re-saving routing must retry the upsert for existing hostnames, not only
    the diff (an empty diff after a failed upsert left the A record missing
    forever)."""
    _ready_imgapp(db_session, frozen_time)

    upserts = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/ports/allocate" and request.method == "POST":
            return httpx.Response(200, json={"port": 10001})
        if path == "/v1/projects/imgapp/env" and request.method == "PATCH":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/nginx/sites" and request.method == "POST":
            return httpx.Response(200, json={"site_id": "imgapp"})
        if path == "/v1/dns/records/upsert" and request.method == "POST":
            upserts.append(json.loads(request.content.decode()))
            return httpx.Response(200, json={"fqdn": "example.com"})
        return httpx.Response(404, json={"detail": "unexpected"})

    body = {
        "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
        "routes": [{"path_prefix": "/", "port_env_var": "WEB_PORT"}],
    }
    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        resp = client.put(
            "/api/projects/imgapp/routing",
            json=body,
            headers=_csrf(auth),
        )
        assert resp.status_code == 200, resp.text
        # second save: no hostnames changed — the upsert must be retried anyway
        resp = client.put(
            "/api/projects/imgapp/routing",
            json=body,
            headers=_csrf(auth),
        )
        assert resp.status_code == 200, resp.text

    assert len(upserts) == 2, f"expected idempotent upsert on every save, got {upserts}"


def test_delete_reports_partial_failures_and_cleans_rows(
    client_factory, admin_user, frozen_time, db_session
):
    """Transient agent failures during delete must not leave panel rows
    (secrets) behind; the response reports what failed."""
    from datetime import timedelta

    import pyotp

    from vpscp_panel.models import Project as _Project

    _ready_imgapp(db_session, frozen_time)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, json={"detail": "agent exploded"})

    with client_factory(transport=httpx.MockTransport(handler)) as client:
        auth = login(client, admin_user, frozen_time)
        step_time = frozen_time + timedelta(seconds=31)
        client.app.state.clock = lambda: step_time
        code = pyotp.TOTP(admin_user["totp_secret"]).at(step_time)
        client.post("/api/auth/step-up", json={"code": code}, headers=_csrf(auth))
        resp = client.request(
            "DELETE",
            "/api/projects/imgapp",
            headers=_csrf(auth),
            json={"confirm": "imgapp", "drop_database": False, "remove_dns": False},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["warnings"], "partial failures must be reported"
    with db_module.SessionLocal() as session:
        assert session.get(_Project, "imgapp") is None


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
                "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
                "routes": [
                    {"path_prefix": "/", "port_env_var": "WEB_PORT"},
                ],
            },
            headers=_csrf(auth),
        )
        assert response.status_code == 200, response.text

    assert len(env_patches) == 1
    assert env_patches[0]["set"] == {"WEB_PORT": "10001"}


def test_put_routing_rejects_duplicate_paths(client_factory, admin_user, frozen_time, db_session):
    _ready_imgapp(db_session, frozen_time)

    with client_factory() as client:
        auth = login(client, admin_user, frozen_time)
        response = client.put(
            "/api/projects/imgapp/routing",
            json={
                "hostnames": [{"domain": "example.com", "subdomain": "", "kind": "primary"}],
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
