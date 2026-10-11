import pytest

from vpscp_agent import audit
from vpscp_agent.state import StateDB


@pytest.fixture
def db(tmp_path) -> StateDB:
    state = StateDB(tmp_path / "state.db")
    state.migrate()
    return state


def test_mask_secrets_masks_secret_named_keys_recursively():
    params = {
        "slug": "budgethq",
        "password": "hunter2",
        "cloudflare_token": "cf",
        "nested": {"client_secret": "x", "name": "n"},
        "items": [{"private_key": "k", "port": 10000}],
    }

    masked = audit.mask_secrets(params)

    assert masked == {
        "slug": "budgethq",
        "password": "***",
        "cloudflare_token": "***",
        "nested": {"client_secret": "***", "name": "n"},
        "items": [{"private_key": "***", "port": 10000}],
    }
    assert params["password"] == "hunter2"


def test_mask_secrets_masks_extra_fields():
    masked = audit.mask_secrets({"values": {"A": "1"}, "slug": "x"}, frozenset({"values"}))

    assert masked == {"values": "***", "slug": "x"}


def test_record_and_list_events_newest_first(db):
    first = audit.record(db, "db.create", {"name": "a"}, ok=True, error=None, duration_ms=5)
    second = audit.record(
        db, "db.drop", {"name": "b", "password": "p"}, ok=False, error="boom", duration_ms=7
    )

    events = audit.list_events(db)

    assert [e.id for e in events] == [second, first]
    assert events[0].operation == "db.drop"
    assert events[0].params == {"name": "b", "password": "***"}
    assert events[0].ok is False
    assert events[0].error == "boom"
    assert events[1].ok is True


def test_list_events_paginates_with_before_id(db):
    ids = [audit.record(db, "op", {"n": n}, ok=True, error=None, duration_ms=1) for n in range(5)]

    page = audit.list_events(db, limit=2, before_id=ids[3])

    assert [e.id for e in page] == [ids[2], ids[1]]


def test_audited_records_success(db):
    with audit.audited(db, "nginx.write_site", {"slug": "budgethq"}):
        pass

    [event] = audit.list_events(db)
    assert event.operation == "nginx.write_site"
    assert event.ok is True
    assert event.error is None
    assert event.duration_ms >= 0


def test_audited_records_failure_and_reraises(db):
    with pytest.raises(RuntimeError), audit.audited(db, "db.create", {"name": "x"}):
        raise RuntimeError("already exists")

    [event] = audit.list_events(db)
    assert event.ok is False
    assert event.error == "RuntimeError: already exists"


def test_audit_endpoint_lists_events(client):
    db = client.app.state.db
    audit.record(db, "db.create", {"name": "a"}, ok=True, error=None, duration_ms=1)

    response = client.get("/v1/audit", params={"limit": 10})

    assert response.status_code == 200
    [event] = response.json()
    assert event["operation"] == "db.create"
    assert event["params"] == {"name": "a"}


def test_audit_endpoint_rejects_large_limit(client):
    assert client.get("/v1/audit", params={"limit": 1000}).status_code == 422
