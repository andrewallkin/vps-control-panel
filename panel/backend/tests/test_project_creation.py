import json
from datetime import UTC, datetime

import httpx
import pytest
from conftest import login
from sqlalchemy import select

import vpscp_panel.db as db_module
from vpscp_panel.agent_client import AgentClient
from vpscp_panel.models import (
    Domain,
    PortAllocation,
    Project,
    ProjectHostname,
    ProjectRoute,
    ProjectService,
)
from vpscp_panel.project_creation import initial_creation_state, run_creation


def _make_project(
    db,
    *,
    slug: str = "myapp",
    database_mode: str = "new",
    write_database_url: bool = True,
    user_env: str | None = None,
    repo_url: str = "https://github.com/acme/myapp.git",
    deploy_mode: str = "build",
    docker_hub_repo: str | None = None,
) -> Project:
    db.add(
        Domain(
            name="example.com",
            zone_id="zone-1",
            cert_status="missing",
            cert_expires_at=None,
        )
    )
    project = Project(
        slug=slug,
        display_name="My App",
        repo_url=repo_url,
        branch="main",
        compose_file="docker-compose.yml",
        deploy_mode=deploy_mode,
        docker_hub_repo=docker_hub_repo,
        database_mode=database_mode,
        db_name="myapp",
        db_user="myapp_user",
        write_database_url=write_database_url,
        migration_command=None,
        migration_service=None,
        health_check_url=None,
        user_env=user_env,
        creation_state=json.dumps(initial_creation_state()),
        created_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
    )
    db.add(project)
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
            max_body_mb=25,
            read_timeout_s=60,
            send_timeout_s=60,
            streaming=False,
            websocket=False,
            pass_authorization=False,
        )
    )
    db.commit()
    return project


@pytest.fixture
def db_session(panel_settings):
    from vpscp_panel.db import init_db, run_migrations

    run_migrations(panel_settings)
    init_db(panel_settings)
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as session:
        yield session


@pytest.mark.asyncio
async def test_run_creation_happy_path_env_merge(db_session):
    calls: list[tuple[str, str]] = []
    env_put_content: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        path = request.url.path
        if path == "/v1/projects" and request.method == "POST":
            return httpx.Response(200, json={"slug": "myapp"})
        if path == "/v1/projects/myapp/clone" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-1"})
        if path == "/v1/jobs/job-1" and request.method == "GET":
            return httpx.Response(200, json={"status": "succeeded"})
        if path == "/v1/ports/allocate" and request.method == "POST":
            body = json.loads(request.content.decode())
            assert body == {"owner": "myapp", "env_var": "APP_PORT"}
            return httpx.Response(200, json={"port": 10001})
        if path == "/v1/db/create" and request.method == "POST":
            return httpx.Response(
                200,
                json={"db_name": "myapp", "db_user": "myapp_user", "password": "p@ss word"},
            )
        if path == "/v1/projects/myapp/env" and request.method == "PUT":
            body = json.loads(request.content.decode())
            env_put_content.append(body["content"])
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/nginx/sites" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/dns/records/upsert" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    _make_project(
        db_session,
        user_env="POSTGRES_PASSWORD=nope\nAPP_SECRET=abc\n",
    )

    await run_creation(db_session, agent, "myapp")

    db_session.refresh(db_session.get(Project, "myapp"))
    project = db_session.get(Project, "myapp")
    assert project is not None
    state = json.loads(project.creation_state)
    assert state["status"] == "ready"
    assert state["db_password"] is None

    assert len(env_put_content) == 1
    content = env_put_content[0]
    assert "POSTGRES_HOST=postgres-central" in content
    assert "POSTGRES_PASSWORD=p@ss word" in content
    assert "POSTGRES_PASSWORD=nope" not in content
    assert "APP_SECRET=abc" in content
    assert (
        "DATABASE_URL=postgresql://myapp_user:p%40ss%20word@postgres-central:5432/myapp" in content
    )

    ports = db_session.scalars(
        select(PortAllocation).where(PortAllocation.project_slug == "myapp")
    ).all()
    assert len(ports) == 1
    assert ports[0].host_port == 10001
    assert ports[0].env_var == "APP_PORT"


@pytest.mark.asyncio
async def test_run_creation_retries_after_nginx_failure(db_session):
    register_posts: list[httpx.Request] = []
    nginx_attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects" and request.method == "POST":
            register_posts.append(request)
            return httpx.Response(200, json={"slug": "myapp"})
        if path == "/v1/projects/myapp/clone" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-1"})
        if path == "/v1/jobs/job-1" and request.method == "GET":
            return httpx.Response(200, json={"status": "succeeded"})
        if path == "/v1/ports/allocate" and request.method == "POST":
            return httpx.Response(200, json={"port": 10002})
        if path == "/v1/db/create" and request.method == "POST":
            return httpx.Response(
                200,
                json={"db_name": "myapp", "db_user": "myapp_user", "password": "secret123"},
            )
        if path == "/v1/projects/myapp/env" and request.method == "PUT":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/nginx/sites" and request.method == "POST":
            nginx_attempts["count"] += 1
            if nginx_attempts["count"] == 1:
                return httpx.Response(500, json={"detail": "nginx apply failed"})
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/dns/records/upsert" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    _make_project(db_session, write_database_url=False, user_env=None)

    await run_creation(db_session, agent, "myapp")
    project = db_session.get(Project, "myapp")
    assert project is not None
    state = json.loads(project.creation_state)
    assert state["status"] == "failed"
    step_by_name = {s["name"]: s for s in state["steps"]}
    assert step_by_name["register"]["status"] == "done"
    assert step_by_name["clone"]["status"] == "done"
    assert step_by_name["ports"]["status"] == "done"
    assert step_by_name["database"]["status"] == "done"
    assert step_by_name["env"]["status"] == "done"
    assert step_by_name["nginx"]["status"] == "failed"
    assert step_by_name["dns"]["status"] == "pending"

    await run_creation(db_session, agent, "myapp")
    project = db_session.get(Project, "myapp")
    assert project is not None
    state = json.loads(project.creation_state)
    assert state["status"] == "ready"
    assert len(register_posts) == 1
    assert nginx_attempts["count"] == 2


@pytest.mark.asyncio
async def test_run_creation_fails_when_clone_returns_no_job_id(db_session):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects" and request.method == "POST":
            return httpx.Response(200, json={"slug": "myapp"})
        if path == "/v1/projects/myapp/clone" and request.method == "POST":
            return httpx.Response(200, json={})
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    _make_project(db_session)

    await run_creation(db_session, agent, "myapp")

    project = db_session.get(Project, "myapp")
    assert project is not None
    state = json.loads(project.creation_state)
    assert state["status"] == "failed"
    step_by_name = {s["name"]: s for s in state["steps"]}
    assert step_by_name["clone"]["status"] == "failed"
    assert step_by_name["clone"]["error"]


@pytest.mark.asyncio
async def test_run_creation_image_mode_discovers_services_after_clone(db_session):
    compose_payload = {
        "services": [
            {"name": "web", "image": "", "image_var": "DOCKER_IMAGE_WEB"},
            {"name": "worker", "image": "", "image_var": "DOCKER_IMAGE_WORKER"},
        ],
        "networks": ["postgres-net"],
        "warning": None,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects" and request.method == "POST":
            return httpx.Response(200, json={"slug": "imgapp"})
        if path == "/v1/projects/imgapp/clone" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-1"})
        if path == "/v1/jobs/job-1" and request.method == "GET":
            return httpx.Response(200, json={"status": "succeeded"})
        if path == "/v1/projects/imgapp/compose-services" and request.method == "GET":
            return httpx.Response(200, json=compose_payload)
        if path == "/v1/ports/allocate" and request.method == "POST":
            return httpx.Response(200, json={"port": 10001})
        if path == "/v1/projects/imgapp/env" and request.method == "PUT":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/nginx/sites" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/dns/records/upsert" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    _make_project(
        db_session,
        slug="imgapp",
        database_mode="none",
        write_database_url=False,
        deploy_mode="image",
        docker_hub_repo="acme/imgapp",
    )

    await run_creation(db_session, agent, "imgapp")

    rows = db_session.scalars(
        select(ProjectService).where(ProjectService.project_slug == "imgapp")
    ).all()
    assert len(rows) == 2
    by_name = {row.service_name: row for row in rows}
    assert by_name["web"].image_env_var == "DOCKER_IMAGE_WEB"
    assert by_name["web"].tag_prefix == "web"
    assert by_name["worker"].tag_prefix == "worker"


@pytest.mark.asyncio
async def test_run_creation_skips_discovery_when_user_services_exist(db_session):
    compose_calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects" and request.method == "POST":
            return httpx.Response(200, json={"slug": "imgapp"})
        if path == "/v1/projects/imgapp/clone" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-1"})
        if path == "/v1/jobs/job-1" and request.method == "GET":
            return httpx.Response(200, json={"status": "succeeded"})
        if path == "/v1/projects/imgapp/compose-services" and request.method == "GET":
            compose_calls.append(path)
            return httpx.Response(200, json={"services": []})
        if path == "/v1/ports/allocate" and request.method == "POST":
            return httpx.Response(200, json={"port": 10001})
        if path == "/v1/projects/imgapp/env" and request.method == "PUT":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/nginx/sites" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        if path == "/v1/dns/records/upsert" and request.method == "POST":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    _make_project(
        db_session,
        slug="imgapp",
        database_mode="none",
        write_database_url=False,
        deploy_mode="image",
        docker_hub_repo="acme/imgapp",
    )
    db_session.add(
        ProjectService(
            project_slug="imgapp",
            service_name="api",
            image_env_var="DOCKER_IMAGE_API",
            tag_prefix="api",
            current_tag=None,
        )
    )
    db_session.commit()

    await run_creation(db_session, agent, "imgapp")

    rows = db_session.scalars(
        select(ProjectService).where(ProjectService.project_slug == "imgapp")
    ).all()
    assert len(rows) == 1
    assert rows[0].service_name == "api"
    assert compose_calls == []


def test_delete_project_requires_csrf(client, admin_user, frozen_time, db_session):
    login(client, admin_user, frozen_time)
    _make_project(db_session, slug="delme")

    response = client.request(
        "DELETE",
        "/api/projects/delme",
        json={"confirm": "delme"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "csrf_failed"}
