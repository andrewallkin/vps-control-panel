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


def test_adopt_route_rotate_and_audit(db_client, monkeypatch):
    client, runner = db_client
    runner.on("pg_database", stdout="1\n")
    runner.on("pg_roles", stdout="1\n")
    runner.on("docker", stdout="")
    fixed = "abcdefghijklmnopqrstuvwxyz012345"
    monkeypatch.setattr("vpscp_agent.db_ops.generate_password", lambda: fixed)

    response = client.post(
        "/v1/db/adopt",
        json={
            "slug": "legacy-app",
            "db_name": "legacyapp",
            "db_user": "legacyapp_user",
            "password_mode": "rotate",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"password": fixed}
    [event] = audit.list_events(client.app.state.db)
    assert event.operation == "db.adopt"
    assert event.params == {
        "slug": "legacy-app",
        "db_name": "legacyapp",
        "db_user": "legacyapp_user",
        "password_mode": "rotate",
    }


def test_adopt_keep_verification_failed_400(db_client):
    client, runner = db_client
    runner.on("pg_database", stdout="1\n")
    runner.on("pg_roles", stdout="1\n")
    runner.on("SELECT 1", stdout="", returncode=1)

    response = client.post(
        "/v1/db/adopt",
        json={
            "slug": "legacy-app",
            "db_name": "legacyapp",
            "db_user": "legacyapp_user",
            "password_mode": "keep",
            "password": "wrong",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "password verification failed"


def test_drop_route_204_and_audit(db_client):
    client, runner = db_client
    runner.on("docker", stdout="")
    db = client.app.state.db
    with db.connect() as conn:
        from datetime import UTC, datetime

        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            (
                "legacyapp",
                "legacyapp_user",
                "legacy-app",
                datetime.now(UTC).isoformat(timespec="seconds"),
            ),
        )

    response = client.post(
        "/v1/db/drop",
        json={"db_name": "legacyapp", "confirm": "legacyapp", "drop_role": False},
    )

    assert response.status_code == 204
    assert response.content == b""
    [event] = audit.list_events(db)
    assert event.operation == "db.drop"
    assert event.params == {
        "db_name": "legacyapp",
        "confirm": "legacyapp",
        "drop_role": False,
    }


def test_drop_confirm_mismatch_400(db_client):
    client, _runner = db_client

    response = client.post(
        "/v1/db/drop",
        json={"db_name": "legacyapp", "confirm": "typo", "drop_role": False},
    )

    assert response.status_code == 400


def test_drop_reserved_400(db_client):
    client, _runner = db_client

    response = client.post(
        "/v1/db/drop",
        json={"db_name": "postgres", "confirm": "postgres", "drop_role": False},
    )

    assert response.status_code == 400


def test_detach_route_204(db_client):
    client, _runner = db_client
    db = client.app.state.db
    with db.connect() as conn:
        from datetime import UTC, datetime

        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            (
                "legacyapp",
                "legacyapp_user",
                "legacy-app",
                datetime.now(UTC).isoformat(timespec="seconds"),
            ),
        )

    response = client.post("/v1/db/detach", json={"slug": "legacy-app"})

    assert response.status_code == 204
    [event] = audit.list_events(db)
    assert event.operation == "db.detach"
    assert event.params == {"slug": "legacy-app"}
