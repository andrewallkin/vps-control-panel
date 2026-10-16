import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from conftest import login, totp_code
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

import vpscp_panel.db as db_module
from vpscp_panel.agent_client import AgentClient
from vpscp_panel.models import Deploy, Domain, Project, ProjectService


def _ready_project(
    db,
    *,
    slug: str = "myapp",
    deploy_mode: str = "image",
    database_mode: str = "new",
    branch: str = "main",
    docker_hub_repo: str | None = "acme/myapp",
) -> Project:
    from vpscp_panel.project_creation import initial_creation_state

    state = initial_creation_state()
    state["status"] = "ready"
    for step in state["steps"]:
        step["status"] = "done"

    if db.get(Domain, "example.com") is None:
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
        repo_url="https://github.com/acme/myapp.git",
        branch=branch,
        compose_file="docker-compose.yml",
        deploy_mode=deploy_mode,
        docker_hub_repo=docker_hub_repo,
        database_mode=database_mode,
        db_name="myapp",
        db_user="myapp_user",
        write_database_url=True,
        migration_command="alembic upgrade head",
        migration_service="web",
        health_check_url="http://127.0.0.1:10000/",
        user_env=None,
        creation_state=json.dumps(state),
        created_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
    )
    db.add(project)
    db.commit()
    return project


def _sse_bytes(*events: tuple[str, dict]) -> bytes:
    chunks: list[str] = []
    for event_type, payload in events:
        chunks.append(f"event: {event_type}\ndata: {json.dumps(payload)}\n\n")
    return "".join(chunks).encode()


@pytest.fixture
def db_session(panel_settings):
    from vpscp_panel.db import init_db, run_migrations

    run_migrations(panel_settings)
    init_db(panel_settings)
    assert db_module.SessionLocal is not None
    with db_module.SessionLocal() as session:
        yield session


@pytest.fixture
def agent_requests():
    return []


def test_image_deploy_succeeded(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    _ready_project(db_session)
    db_session.add(
        ProjectService(
            project_slug="myapp",
            service_name="web",
            image_env_var="DOCKER_IMAGE_WEB",
            tag_prefix="backend",
            current_tag=None,
        )
    )
    db_session.commit()
    tags = {"DOCKER_IMAGE_WEB": "backend-main-abc1234"}
    deploy_post_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/projects/myapp/deploy" and request.method == "POST":
            deploy_post_bodies.append(json.loads(request.content.decode()))
            return httpx.Response(200, json={"job_id": "job-deploy-1"})
        if path == "/v1/jobs/job-deploy-1/events" and request.method == "GET":
            return httpx.Response(
                200,
                content=_sse_bytes(
                    ("line", {"n": 0, "text": "hello"}),
                    (
                        "end",
                        {
                            "status": "succeeded",
                            "result": {"commit": "abc1234", "tags": tags},
                            "error": None,
                        },
                    ),
                ),
            )
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)

    response = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "succeeded"
    assert "id" in body

    assert len(deploy_post_bodies) == 1
    agent_body = deploy_post_bodies[0]
    assert agent_body["mode"] == "image"
    assert agent_body["tags"] == tags
    assert agent_body["db"] is True

    with db_module.SessionLocal() as db:
        row = db.get(Deploy, body["id"])
        assert row is not None
        assert row.status == "succeeded"
        assert row.commit == "abc1234"
        assert "hello" in row.log
        svc = db.scalars(select(ProjectService).where(ProjectService.project_slug == "myapp")).one()
        assert svc.current_tag == "backend-main-abc1234"


def test_deploys_list_includes_agent_job_id(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    """Each deploy row exposes the agent's job_id so the frontend can stream
    live log lines over SSE while the deploy runs."""
    _ready_project(db_session)
    tags = {"DOCKER_IMAGE_WEB": "backend-main-abc1234"}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects/myapp/deploy" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-live-1"})
        if path == "/v1/jobs/job-live-1/events" and request.method == "GET":
            return httpx.Response(
                200,
                content=_sse_bytes(
                    ("line", {"n": 0, "text": "hello"}),
                    ("end", {"status": "succeeded", "result": {}, "error": None}),
                ),
            )
        return httpx.Response(404, json={"detail": f"unexpected {request.method} {path}"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)

    response = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags},
    )
    assert response.status_code == 202, response.text

    listing = client.get("/api/projects/myapp/deploys")
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    assert rows, "expected at least one deploy row"
    assert rows[0]["job_id"] == "job-live-1"


def test_deploy_finished_at_uses_end_clock(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    _ready_project(db_session)
    tags = {"DOCKER_IMAGE_WEB": "backend-main-abc1234"}
    end_time = frozen_time + timedelta(minutes=5)
    call_count = [0]

    def clock():
        call_count[0] += 1
        return frozen_time if call_count[0] == 1 else end_time

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/projects/myapp/deploy" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-finish-time"})
        if path == "/v1/jobs/job-finish-time/events":
            return httpx.Response(
                200,
                content=_sse_bytes(
                    (
                        "end",
                        {
                            "status": "succeeded",
                            "result": {"commit": "abc1234"},
                            "error": None,
                        },
                    ),
                ),
            )
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)
    call_count[0] = 0
    client.app.state.clock = clock

    response = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags},
    )
    assert response.status_code == 202, response.text

    with db_module.SessionLocal() as db:
        row = db.get(Deploy, response.json()["id"])
        assert row is not None
        assert row.finished_at == end_time.replace(tzinfo=None)
        assert row.finished_at != frozen_time.replace(tzinfo=None)


def test_run_deploy_cancellation_finalizes_row(client_factory, admin_user, frozen_time, db_session):
    """A cancelled deploy (client disconnect / panel shutdown) must not leave
    status='running' forever — that bricks deploys for the project."""
    import asyncio

    from vpscp_panel import deploy_ops

    _ready_project(db_session)

    async def cancelled_consume(agent, job_id):
        raise asyncio.CancelledError

    class StubAgent:
        async def post(self, path, json=None):
            return {"job_id": "job-1"}

    original = deploy_ops.consume_job_events
    deploy_ops.consume_job_events = cancelled_consume
    try:
        with db_module.SessionLocal() as session:
            project = session.get(Project, "myapp")
            with pytest.raises(asyncio.CancelledError):
                asyncio.run(
                    deploy_ops.run_deploy(
                        session,
                        StubAgent(),
                        project,
                        tags={"DOCKER_IMAGE_WEB": "x"},
                        trigger="deploy",
                        clock=lambda: frozen_time,
                    )
                )
        with db_module.SessionLocal() as session:
            row = session.scalars(select(Deploy).where(Deploy.project_slug == "myapp")).one()
            assert row.status == "failed"
            assert row.finished_at is not None
    finally:
        deploy_ops.consume_job_events = original


def test_reconcile_stuck_work_marks_orphaned_creations(db_session, frozen_time):
    """Startup reconciliation marks orphaned creations failed so retries work.
    Deploy rows are deliberately NOT mass-failed: reconcile_deploy_jobs
    finalizes them from the agent's terminal job state (a running job may
    have switched containers on its own — failing the row would lie)."""
    from vpscp_panel.deploy_ops import reconcile_stuck_work

    _ready_project(db_session)
    db_session.add(
        Deploy(
            project_slug="myapp",
            started_at=frozen_time,
            finished_at=None,
            status="running",
            tags_json="{}",
            log="",
            trigger="deploy",
            commit=None,
        )
    )
    project = db_session.get(Project, "myapp")
    state = json.loads(project.creation_state)
    state["status"] = "running"
    project.creation_state = json.dumps(state)
    db_session.commit()

    reconcile_stuck_work(db_session, lambda: frozen_time)

    row = db_session.scalars(select(Deploy).where(Deploy.project_slug == "myapp")).one()
    assert row.status == "running", "deploy rows are left to reconcile_deploy_jobs"
    project = db_session.get(Project, "myapp")
    assert json.loads(project.creation_state)["status"] == "failed"


def test_deploy_run_migrations_flag_controls_migrate_step(
    client_factory, admin_user, frozen_time, db_session
):
    """The deploy dialog's 'Run database migrations' checkbox gates whether the
    migrate step is sent to the agent. Default is run (pre-ticked)."""
    _ready_project(db_session)
    with db_module.SessionLocal() as session:
        project = session.get(Project, "myapp")
        project.migration_service = "web"
        project.migration_command = "bash /app/run_migrations.sh"
        session.commit()

    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/projects/myapp/deploy" and request.method == "POST":
            bodies.append(json.loads(request.content.decode()))
            return httpx.Response(200, json={"job_id": "job-deploy-1"})
        if path == "/v1/jobs/job-deploy-1/events" and request.method == "GET":
            return httpx.Response(
                200,
                content=_sse_bytes(
                    ("end", {"status": "succeeded", "result": {}, "error": None}),
                ),
            )
        return httpx.Response(404, json={"detail": "unexpected"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)
    tags = {"DOCKER_IMAGE_WEB": "backend-main-abc1234"}

    # default: migrations run
    resp = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags},
    )
    assert resp.status_code == 202, resp.text
    assert bodies[-1]["migration"] == {
        "service": "web",
        "command": "bash /app/run_migrations.sh",
    }

    # unchecked: migrate step omitted entirely
    resp = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags, "run_migrations": False},
    )
    assert resp.status_code == 202, resp.text
    assert "migration" not in bodies[-1]


def test_reconcile_finalizes_from_agent_job(frozen_time, db_session):
    """Panel restart mid-deploy: the agent job keeps running and finishes on
    its own. Startup reconciliation must finalize the row from the agent's
    terminal state — not mass-fail it while containers actually switched."""
    import asyncio

    from vpscp_panel.deploy_ops import reconcile_deploy_jobs

    _ready_project(db_session)
    with db_module.SessionLocal() as session:
        session.add(
            Deploy(
                project_slug="myapp",
                started_at=frozen_time,
                finished_at=None,
                status="running",
                tags_json="{}",
                log="",
                trigger="deploy",
                commit=None,
                job_id="job-1",
            )
        )
        session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/jobs/job-1":
            return httpx.Response(
                200,
                json={
                    "id": "job-1",
                    "status": "succeeded",
                    "result": {"commit": "abc123"},
                    "log": "done",
                },
            )
        return httpx.Response(404, json={"detail": "nope"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    asyncio.run(reconcile_deploy_jobs(db_module.SessionLocal, agent, lambda: frozen_time))

    with db_module.SessionLocal() as session:
        row = session.scalars(select(Deploy).where(Deploy.project_slug == "myapp")).one()
        assert row.status == "succeeded"
        assert row.finished_at is not None


def test_reconcile_fails_row_when_agent_job_vanished(frozen_time, db_session):
    import asyncio

    from vpscp_panel.deploy_ops import reconcile_deploy_jobs

    _ready_project(db_session)
    with db_module.SessionLocal() as session:
        session.add(
            Deploy(
                project_slug="myapp",
                started_at=frozen_time,
                finished_at=None,
                status="running",
                tags_json="{}",
                log="",
                trigger="deploy",
                commit=None,
                job_id="job-gone",
            )
        )
        session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "job not found"})

    agent = AgentClient("/fake.sock", transport=httpx.MockTransport(handler))
    asyncio.run(reconcile_deploy_jobs(db_module.SessionLocal, agent, lambda: frozen_time))

    with db_module.SessionLocal() as session:
        row = session.scalars(select(Deploy).where(Deploy.project_slug == "myapp")).one()
        assert row.status == "failed"


def test_only_one_running_deploy_per_slug(db_session):
    _ready_project(db_session)
    started = datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC)
    tags = "{}"
    db_session.add(
        Deploy(
            project_slug="myapp",
            started_at=started,
            finished_at=None,
            status="running",
            tags_json=tags,
            log="",
            trigger="deploy",
            commit=None,
        )
    )
    db_session.commit()
    db_session.add(
        Deploy(
            project_slug="myapp",
            started_at=started,
            finished_at=None,
            status="running",
            tags_json=tags,
            log="",
            trigger="deploy",
            commit=None,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_deploy_failed_after_switch(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    _ready_project(db_session)
    tags = {"DOCKER_IMAGE_WEB": "backend-main-abc1234"}

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/projects/myapp/deploy" and request.method == "POST":
            return httpx.Response(200, json={"job_id": "job-deploy-2"})
        if path == "/v1/jobs/job-deploy-2/events":
            return httpx.Response(
                200,
                content=_sse_bytes(
                    (
                        "end",
                        {
                            "status": "failed",
                            "result": None,
                            "error": "DeployFailed: failed_after_switch: up failed",
                        },
                    ),
                ),
            )
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)

    response = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags},
    )
    assert response.status_code == 202
    assert response.json()["status"] == "failed_after_switch"

    with db_module.SessionLocal() as db:
        row = db.get(Deploy, response.json()["id"])
        assert row is not None
        assert row.status == "failed_after_switch"


def test_redeploy_succeeded_row(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    _ready_project(db_session)
    tags = {"DOCKER_IMAGE_WEB": "backend-main-abc1234"}
    deploy_calls = 0
    deploy_post_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/projects/myapp/deploy" and request.method == "POST":
            nonlocal deploy_calls
            deploy_calls += 1
            deploy_post_bodies.append(json.loads(request.content.decode()))
            job_id = f"job-redeploy-{deploy_calls}"
            return httpx.Response(200, json={"job_id": job_id})
        if path.startswith("/v1/jobs/job-redeploy-") and path.endswith("/events"):
            return httpx.Response(
                200,
                content=_sse_bytes(
                    (
                        "end",
                        {
                            "status": "succeeded",
                            "result": {"commit": "abc1234"},
                            "error": None,
                        },
                    ),
                ),
            )
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)

    first = client.post(
        "/api/projects/myapp/deploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
        json={"tags": tags},
    )
    assert first.status_code == 202
    deploy_id = first.json()["id"]

    redeploy = client.post(
        f"/api/deploys/{deploy_id}/redeploy",
        headers={"X-CSRF-Token": auth["csrf_token"]},
    )
    assert redeploy.status_code == 202, redeploy.text
    assert deploy_post_bodies[1]["tags"] == tags

    with db_module.SessionLocal() as db:
        rows = db.scalars(select(Deploy).where(Deploy.project_slug == "myapp")).all()
        redeploy_rows = [r for r in rows if r.trigger == "redeploy"]
        assert len(redeploy_rows) == 1


def test_tags_route_registry(client_factory, admin_user, frozen_time, db_session, agent_requests):
    _ready_project(db_session)
    db_session.add(
        ProjectService(
            project_slug="myapp",
            service_name="web",
            image_env_var="DOCKER_IMAGE_WEB",
            tag_prefix="backend",
            current_tag=None,
        )
    )
    db_session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        if request.url.path == "/v1/registry/tags":
            assert request.url.params.get("repo") == "acme/myapp"
            assert request.url.params.get("prefix") == "backend"
            assert request.url.params.get("branch") == "main"
            return httpx.Response(200, json=["backend-main-abc1234"])
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    login(client, admin_user, frozen_time)

    response = client.get("/api/projects/myapp/tags")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["services"][0]["service"] == "web"
    assert data["services"][0]["image_env_var"] == "DOCKER_IMAGE_WEB"
    assert data["services"][0]["tags"] == ["backend-main-abc1234"]


def test_dashboard_project_counts(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    _ready_project(db_session, slug="upapp")
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

    def handler_healthy(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        path = request.url.path
        if path == "/v1/metrics/current":
            return httpx.Response(200, json={"cpus": [], "mem_percent": 50.0, "disks": []})
        if path == "/v1/backup/status":
            return httpx.Response(200, json={"last_run": None})
        if path == "/v1/backup/settings":
            return httpx.Response(200, json={"schedule_hours": "0,12"})
        if path == "/v1/tls/status":
            return httpx.Response(200, json=[])
        if path == "/v1/projects/upapp/compose/ps":
            return httpx.Response(200, json=ps_response)
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler_healthy))
    login(client, admin_user, frozen_time)

    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    projects = response.json()["projects"]
    assert projects["total"] == 1
    assert projects["up"] == 1
    assert projects["unhealthy"] == 0

    ps_response["services"][0]["health"] = "unhealthy"

    response2 = client.get("/api/dashboard/summary")
    projects2 = response2.json()["projects"]
    assert projects2["unhealthy"] == 1
    assert projects2["up"] == 0


def test_delete_cascades_deploy_and_service(
    client_factory, admin_user, frozen_time, db_session, agent_requests
):
    _ready_project(db_session, slug="delme")
    db_session.add(
        ProjectService(
            project_slug="delme",
            service_name="web",
            image_env_var="DOCKER_IMAGE_WEB",
            tag_prefix="backend",
            current_tag=None,
        )
    )
    db_session.add(
        Deploy(
            project_slug="delme",
            started_at=datetime(2025, 6, 15, 12, 0, 0, tzinfo=UTC),
            finished_at=None,
            status="succeeded",
            tags_json="{}",
            log="",
            trigger="deploy",
            commit=None,
        )
    )
    db_session.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        agent_requests.append(request)
        if request.url.path == "/v1/projects/delme" and request.method == "DELETE":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": "not found"})

    client = client_factory(transport=httpx.MockTransport(handler))
    auth = login(client, admin_user, frozen_time)
    step_up = client.post(
        "/api/auth/step-up",
        json={"code": totp_code(admin_user["totp_secret"], frozen_time + timedelta(seconds=30))},
        headers={"X-CSRF-Token": auth["csrf_token"]},
    )
    assert step_up.status_code == 200

    response = client.request(
        "DELETE",
        "/api/projects/delme",
        json={"confirm": "delme"},
        headers={"X-CSRF-Token": auth["csrf_token"]},
    )
    assert response.status_code == 200, response.text

    with db_module.SessionLocal() as db:
        assert db.get(Project, "delme") is None
        deploys = db.scalars(select(Deploy).where(Deploy.project_slug == "delme")).all()
        assert deploys == []
        services = db.scalars(
            select(ProjectService).where(ProjectService.project_slug == "delme")
        ).all()
        assert services == []
