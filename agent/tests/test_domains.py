import sqlite3
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from vpscp_agent import audit
from vpscp_agent.db_ops import ConflictError
from vpscp_agent.domains import list_domains, register_domain, unregister_domain, zone_for_fqdn
from vpscp_agent.hostnames import (
    allocate_port,
    claim_hostnames,
    list_ports,
    list_used_ports,
    release_ports,
    release_site,
)
from vpscp_agent.main import create_app
from vpscp_agent.state import StateDB


@pytest.fixture
def state_db(tmp_path) -> StateDB:
    db = StateDB(tmp_path / "state.db")
    db.migrate()
    return db


def test_register_domain_and_list(state_db: StateDB):
    record = register_domain(state_db, "example.com", "zone-abc")
    assert list_domains(state_db) == [record]


def test_register_domain_duplicate_conflict(state_db: StateDB):
    register_domain(state_db, "example.com", "zone-1")
    with pytest.raises(ConflictError):
        register_domain(state_db, "example.com", "zone-2")


def test_zone_for_fqdn_longest_registered_domain(state_db: StateDB):
    register_domain(state_db, "example.com", "zone-root")
    register_domain(state_db, "app.example.com", "zone-app")

    assert zone_for_fqdn(state_db, "api.app.example.com") == "zone-app"
    assert zone_for_fqdn(state_db, "app.example.com") == "zone-app"
    assert zone_for_fqdn(state_db, "example.com") == "zone-root"
    assert zone_for_fqdn(state_db, "other.com") is None
    assert zone_for_fqdn(state_db, "a.b.example.com") is None


def test_claim_hostnames_replaces_site_set(state_db: StateDB):
    register_domain(state_db, "example.com", "zone-1")
    claim_hostnames(state_db, "mysite", ["app.example.com", "example.com"])

    claim_hostnames(state_db, "mysite", ["www.example.com"])

    with state_db.connect() as conn:
        rows = conn.execute("SELECT fqdn, site FROM hostname ORDER BY fqdn").fetchall()
    assert [(row["fqdn"], row["site"]) for row in rows] == [("www.example.com", "mysite")]


def test_claim_hostnames_fqdn_uniqueness_rollback(state_db: StateDB):
    register_domain(state_db, "example.com", "zone-1")
    claim_hostnames(state_db, "site-a", ["app.example.com"])

    with pytest.raises(ConflictError):
        claim_hostnames(state_db, "site-b", ["app.example.com", "www.example.com"])

    with state_db.connect() as conn:
        rows = conn.execute("SELECT fqdn, site FROM hostname ORDER BY fqdn").fetchall()
    assert [(row["fqdn"], row["site"]) for row in rows] == [("app.example.com", "site-a")]


def test_claim_hostnames_invalid_fqdn_rollback(state_db: StateDB):
    register_domain(state_db, "example.com", "zone-1")
    claim_hostnames(state_db, "mysite", ["app.example.com"])

    with pytest.raises(ValueError):
        claim_hostnames(state_db, "mysite", ["a.b.example.com"])

    with state_db.connect() as conn:
        rows = conn.execute("SELECT fqdn FROM hostname ORDER BY fqdn").fetchall()
    assert [row["fqdn"] for row in rows] == ["app.example.com"]


def test_unregister_domain_blocked_by_hostname(state_db: StateDB):
    register_domain(state_db, "example.com", "zone-1")
    claim_hostnames(state_db, "mysite", ["app.example.com"])

    with pytest.raises(ConflictError):
        unregister_domain(state_db, "example.com")

    release_site(state_db, "mysite")
    unregister_domain(state_db, "example.com")
    assert list_domains(state_db) == []


def test_allocate_port_lowest_free(state_db: StateDB):
    port = allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set())
    assert port == 10000


def test_allocate_port_skips_listening(state_db: StateDB):
    port = allocate_port(
        state_db,
        "owner-a",
        "APP_PORT",
        listening_ports=lambda: {10000, 10001},
    )
    assert port == 10002


def test_allocate_port_idempotent(state_db: StateDB):
    first = allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set())
    second = allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: {10000})
    assert second == first


def test_allocate_port_explicit_free(state_db: StateDB):
    port = allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set(), port=8001)
    assert port == 8001
    assert list_ports(state_db, "owner-a") == [{"port": 8001, "env_var": "APP_PORT"}]


def test_allocate_port_explicit_taken_by_db_conflict(state_db: StateDB):
    allocate_port(state_db, "owner-b", "WEB_PORT", listening_ports=lambda: set())
    with pytest.raises(ConflictError):
        allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set(), port=10000)


def test_allocate_port_explicit_listening_conflict(state_db: StateDB):
    with pytest.raises(ConflictError):
        allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: {8001}, port=8001)


def test_allocate_port_explicit_remaps_own_var(state_db: StateDB):
    first = allocate_port(
        state_db, "owner-a", "APP_PORT", listening_ports=lambda: set(), port=10000
    )
    assert first == 10000
    second = allocate_port(
        state_db, "owner-a", "APP_PORT", listening_ports=lambda: set(), port=10001
    )
    assert second == 10001
    assert list_ports(state_db, "owner-a") == [{"port": 10001, "env_var": "APP_PORT"}]


def test_list_used_ports_merges_allocations_and_listening(state_db: StateDB):
    allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set())
    used = list_used_ports(state_db, listening_ports=lambda: {5432, 10000})
    assert used == [
        {"port": 5432, "owner": None, "env_var": None},
        {"port": 10000, "owner": "owner-a", "env_var": "APP_PORT"},
    ]


def test_allocate_port_retries_after_port_integrity_error(state_db: StateDB, monkeypatch):
    attempts = {"insert": 0}
    real_connect = state_db.connect

    class _ConnWrapper:
        def __init__(self, conn: sqlite3.Connection) -> None:
            self._conn = conn

        def execute(self, sql, parameters=(), /):
            if (
                isinstance(sql, str)
                and "INSERT INTO port_allocation" in sql
                and parameters
                and parameters[0] == 10000
            ):
                attempts["insert"] += 1
                if attempts["insert"] == 1:
                    raise sqlite3.IntegrityError("simulated port collision")
            return self._conn.execute(sql, parameters)

        def __getattr__(self, name: str):
            return getattr(self._conn, name)

    @contextmanager
    def connect_with_collision():
        with real_connect() as conn:
            yield _ConnWrapper(conn)

    monkeypatch.setattr(state_db, "connect", connect_with_collision)
    port = allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set())

    assert port == 10001
    assert attempts["insert"] == 1


def test_release_ports_and_list(state_db: StateDB):
    allocate_port(state_db, "owner-a", "APP_PORT", listening_ports=lambda: set())
    allocate_port(state_db, "owner-a", "OTHER_PORT", listening_ports=lambda: set())

    assert sorted(list_ports(state_db, "owner-a"), key=lambda r: r["port"]) == [
        {"port": 10000, "env_var": "APP_PORT"},
        {"port": 10001, "env_var": "OTHER_PORT"},
    ]

    release_ports(state_db, "owner-a")
    assert list_ports(state_db, "owner-a") == []


@pytest.fixture
def server_client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def test_server_settings_get_put_and_audit(server_client):
    db = server_client.app.state.db
    before = len(audit.list_events(db))

    assert server_client.get("/v1/server/settings").json() == {
        "public_ipv4": None,
        "acme_email": None,
    }

    response = server_client.put(
        "/v1/server/settings",
        json={"public_ipv4": "203.0.113.10", "acme_email": "admin@example.com"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "public_ipv4": "203.0.113.10",
        "acme_email": "admin@example.com",
    }

    [event] = audit.list_events(db)
    assert event.operation == "server.settings.update"
    assert event.ok is True
    assert len(audit.list_events(db)) == before + 1


def test_server_settings_get_not_audited(server_client):
    db = server_client.app.state.db
    before = len(audit.list_events(db))
    server_client.get("/v1/server/settings")
    assert len(audit.list_events(db)) == before


def test_server_settings_partial_update_preserves_omitted(server_client):
    server_client.put(
        "/v1/server/settings",
        json={"public_ipv4": "203.0.113.10", "acme_email": "admin@example.com"},
    )
    response = server_client.put(
        "/v1/server/settings",
        json={"public_ipv4": "198.51.100.5"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "public_ipv4": "198.51.100.5",
        "acme_email": "admin@example.com",
    }


def test_domain_routes(server_client):
    db = server_client.app.state.db

    assert server_client.get("/v1/domains").json() == []

    created = server_client.post(
        "/v1/domains",
        json={"name": "example.com", "zone_id": "zone-123"},
    )
    assert created.status_code == 201
    assert created.json()["name"] == "example.com"
    assert created.json()["zone_id"] == "zone-123"
    assert "created_at" in created.json()

    assert server_client.get("/v1/domains").json()[0]["name"] == "example.com"

    conflict = server_client.post(
        "/v1/domains",
        json={"name": "example.com", "zone_id": "other"},
    )
    assert conflict.status_code == 409

    deleted = server_client.delete("/v1/domains/example.com")
    assert deleted.status_code == 204
    assert server_client.get("/v1/domains").json() == []

    [delete_event, register_event] = audit.list_events(db)[:2]
    assert register_event.operation == "domain.register"
    assert delete_event.operation == "domain.unregister"


def test_delete_unknown_domain_returns_404(server_client):
    response = server_client.delete("/v1/domains/example.com")
    assert response.status_code == 404


def test_register_domain_empty_zone_id_returns_400(server_client):
    response = server_client.post(
        "/v1/domains",
        json={"name": "example.com", "zone_id": ""},
    )
    assert response.status_code == 400


def test_used_ports_route(server_client, monkeypatch):
    db = server_client.app.state.db
    monkeypatch.setattr(
        "vpscp_agent.routes.server._listening_ports",
        lambda: {5432},
    )
    allocate_port(db, "myapp", "WEB_PORT", listening_ports=lambda: set())

    resp = server_client.get("/v1/ports/used")

    assert resp.status_code == 200
    assert resp.json() == [
        {"port": 5432, "owner": None, "env_var": None},
        {"port": 10000, "owner": "myapp", "env_var": "WEB_PORT"},
    ]


def test_port_routes(server_client, monkeypatch):
    db = server_client.app.state.db
    monkeypatch.setattr(
        "vpscp_agent.routes.server._listening_ports",
        lambda: set(),
    )

    allocated = server_client.post(
        "/v1/ports/allocate",
        json={"owner": "myapp", "env_var": "WEB_PORT"},
    )
    assert allocated.status_code == 200
    assert allocated.json() == {"port": 10000}

    listed = server_client.get("/v1/ports", params={"owner": "myapp"})
    assert listed.status_code == 200
    assert listed.json() == [{"port": 10000, "env_var": "WEB_PORT"}]

    released = server_client.post("/v1/ports/release", json={"owner": "myapp"})
    assert released.status_code == 204
    assert server_client.get("/v1/ports", params={"owner": "myapp"}).json() == []

    [release_event, allocate_event] = audit.list_events(db)[:2]
    assert allocate_event.operation == "port.allocate"
    assert release_event.operation == "port.release"


def test_list_used_ports_attributes_container_bindings(state_db: StateDB):
    used = list_used_ports(
        state_db,
        listening_ports=lambda: {8000, 5432},
        container_projects={8000: "spliteasy"},
    )
    assert used == [
        {"port": 5432, "owner": None, "env_var": None},
        {"port": 8000, "owner": "spliteasy", "env_var": None},
    ]


def test_allocate_port_explicit_allows_own_container_binding(state_db: StateDB):
    port = allocate_port(
        state_db,
        "spliteasy",
        "BACKEND_PORT",
        listening_ports=lambda: {8000},
        port=8000,
        container_projects={8000: "spliteasy"},
    )
    assert port == 8000


def test_allocate_port_explicit_conflicts_foreign_container(state_db: StateDB):
    with pytest.raises(ConflictError) as exc_info:
        allocate_port(
            state_db,
            "budget-hq",
            "BACKEND_PORT",
            listening_ports=lambda: {8000},
            port=8000,
            container_projects={8000: "spliteasy"},
        )
    assert "spliteasy" in str(exc_info.value)


def test_used_ports_route_attributes_containers(server_client, monkeypatch):
    monkeypatch.setattr(
        "vpscp_agent.routes.server._listening_ports",
        lambda: {8000, 5432},
    )
    monkeypatch.setattr(
        "vpscp_agent.routes.server._container_projects",
        lambda _runner: {8000: "spliteasy"},
    )

    resp = server_client.get("/v1/ports/used")

    assert resp.status_code == 200
    assert resp.json() == [
        {"port": 5432, "owner": None, "env_var": None},
        {"port": 8000, "owner": "spliteasy", "env_var": None},
    ]
