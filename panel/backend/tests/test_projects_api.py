import httpx
import pytest
from conftest import login

import vpscp_panel.db as db_module
from vpscp_panel.models import Domain, Project


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
