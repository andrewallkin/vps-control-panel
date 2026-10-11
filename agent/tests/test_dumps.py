import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.dumps import dump_path, dump_project
from vpscp_agent.main import create_app
from vpscp_agent.pg import Psql
from vpscp_agent.state import StateDB


@pytest.fixture
def dump_ctx(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    db = StateDB(settings.state_db_path)
    db.migrate()
    psql = Psql(settings, runner)
    return settings, runner, db, psql


def _attach(db: StateDB, *, slug: str, db_name: str, db_user: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            (db_name, db_user, slug, "2026-01-01T00:00:00+00:00"),
        )


@pytest.fixture
def db_client(settings):
    settings.stack_dir.mkdir(parents=True)
    settings.stack_env_path.write_text("POSTGRES_USER=pgadmin\n")
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        yield client, runner


def test_retention_keeps_five_newest_of_seven(dump_ctx, monkeypatch):
    settings, runner, db, psql = dump_ctx
    slug = "budgethq"
    _attach(db, slug=slug, db_name="budgethq", db_user="budgethq_user")

    names = [f"2026010{d}T120000Z.dump" for d in range(1, 8)]
    index = {"i": 0}

    def fake_dump_name() -> str:
        name = names[index["i"]]
        index["i"] += 1
        return name

    monkeypatch.setattr("vpscp_agent.dumps._dump_name_from_now", fake_dump_name)

    for _ in range(7):
        dump_project(settings, psql, runner, db, slug=slug, keep=5)

    dump_dir = settings.dumps_dir / slug
    names = sorted(p.name for p in dump_dir.glob("*.dump"))
    assert len(names) == 5
    assert names == [
        "20260103T120000Z.dump",
        "20260104T120000Z.dump",
        "20260105T120000Z.dump",
        "20260106T120000Z.dump",
        "20260107T120000Z.dump",
    ]


def test_dump_file_mode_600(dump_ctx, monkeypatch):
    settings, runner, db, psql = dump_ctx
    slug = "budgethq"
    _attach(db, slug=slug, db_name="budgethq", db_user="budgethq_user")
    monkeypatch.setattr(
        "vpscp_agent.dumps._dump_name_from_now",
        lambda: "20260201T093000Z.dump",
    )

    dump_project(settings, psql, runner, db, slug=slug)

    path = settings.dumps_dir / slug / "20260201T093000Z.dump"
    assert path.exists()
    assert path.stat().st_mode & 0o777 == 0o600


def test_dump_path_rejects_bad_name(settings):
    with pytest.raises(ValueError, match="invalid dump name"):
        dump_path(settings, "budgethq", "../evil.dump")
    with pytest.raises(ValueError, match="invalid dump name"):
        dump_path(settings, "budgethq", "not-a-dump")


def test_missing_attachment_400(db_client):
    client, runner = db_client
    runner.stream_payload = b"dump"

    response = client.post("/v1/db/dumps/budgethq")

    assert response.status_code == 400


def test_bad_dump_name_download_400(db_client):
    client, _runner = db_client
    db = client.app.state.db
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2026-01-01T00:00:00+00:00"),
        )

    response = client.get("/v1/db/dumps/budgethq/evil.dump")

    assert response.status_code == 400


def test_dump_project_route_audited(db_client, monkeypatch):
    client, runner = db_client
    db = client.app.state.db
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2026-01-01T00:00:00+00:00"),
        )
    monkeypatch.setattr(
        "vpscp_agent.dumps._dump_name_from_now",
        lambda: "20260301T100000Z.dump",
    )
    before = len(audit.list_events(db))

    response = client.post("/v1/db/dumps/budgethq")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "20260301T100000Z.dump"
    assert body["size_bytes"] == len(runner.stream_payload)
    assert len(audit.list_events(db)) == before + 1
    [event] = audit.list_events(db)[-1:]
    assert event.operation == "db.dump_project"
    assert event.params == {"slug": "budgethq"}
    assert event.ok is True


def test_list_dumps_not_audited(db_client, monkeypatch):
    client, _runner = db_client
    db = client.app.state.db
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO db_attachment (db_name, db_user, slug, attached_at) VALUES (?, ?, ?, ?)",
            ("budgethq", "budgethq_user", "budgethq", "2026-01-01T00:00:00+00:00"),
        )
    monkeypatch.setattr(
        "vpscp_agent.dumps._dump_name_from_now",
        lambda: "20260301T100000Z.dump",
    )
    client.post("/v1/db/dumps/budgethq")
    before = len(audit.list_events(db))

    response = client.get("/v1/db/dumps/budgethq")

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert len(audit.list_events(db)) == before
