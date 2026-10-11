import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.main import create_app


@pytest.fixture
def db_client(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        yield client, runner


def test_list_databases_and_roles_not_audited(db_client):
    client, runner = db_client
    runner.on("pg_database", stdout="myapp,pgadmin,100\n")
    runner.on("pg_roles", stdout="myapp_user\n")

    db = client.app.state.db
    before = len(audit.list_events(db))

    assert client.get("/v1/db/databases").status_code == 200
    assert client.get("/v1/db/roles").status_code == 200
    assert len(audit.list_events(db)) == before


def test_create_database_route_201_and_audit(db_client, monkeypatch):
    client, runner = db_client
    runner.on("pg_database", stdout="")
    runner.on("pg_roles", stdout="")
    runner.on("docker", stdout="")
    fixed = "abcdefghijklmnopqrstuvwxyz012345"
    monkeypatch.setattr("vpscp_agent.db_ops.generate_password", lambda: fixed)

    response = client.post(
        "/v1/db/create",
        json={"slug": "budgethq", "db_name": "budgethq", "db_user": "budgethq_user"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "db_name": "budgethq",
        "db_user": "budgethq_user",
        "password": fixed,
    }
    db = client.app.state.db
    [event] = audit.list_events(db)
    assert event.operation == "db.create"
    assert event.params == {
        "slug": "budgethq",
        "db_name": "budgethq",
        "db_user": "budgethq_user",
    }
    assert event.ok is True


def test_create_database_conflict_409(db_client):
    client, runner = db_client
    runner.on("pg_database", stdout="")
    runner.on("pg_roles", stdout="budgethq_user\n")

    response = client.post(
        "/v1/db/create",
        json={"slug": "budgethq", "db_name": "budgethq", "db_user": "budgethq_user"},
    )

    assert response.status_code == 409


def test_bad_sql_ident_400(db_client):
    client, _runner = db_client

    response = client.post(
        "/v1/db/create",
        json={"slug": "budgethq", "db_name": "Bad-Name", "db_user": "budgethq_user"},
    )

    assert response.status_code == 400


def test_rotate_password_route_200(db_client, monkeypatch):
    client, runner = db_client
    runner.on("docker", stdout="")
    fixed = "rotatedpass1234567890123456789012"
    monkeypatch.setattr("vpscp_agent.db_ops.generate_password", lambda: fixed)

    response = client.post("/v1/db/rotate-password", json={"db_user": "app_user"})

    assert response.status_code == 200
    assert response.json() == {"password": fixed}
    [event] = audit.list_events(client.app.state.db)
    assert event.operation == "db.rotate_password"
    assert event.params == {"db_user": "app_user"}


def test_verify_password_route_masks_audit(db_client):
    client, runner = db_client
    runner.on("SELECT 1", stdout="1\n", returncode=0)

    response = client.post(
        "/v1/db/verify-password",
        json={"db_user": "app_user", "db_name": "appdb", "password": "hunter2"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    [event] = audit.list_events(client.app.state.db)
    assert event.operation == "db.verify_password"
    assert event.params == {
        "db_user": "app_user",
        "db_name": "appdb",
        "password": "***",
    }
