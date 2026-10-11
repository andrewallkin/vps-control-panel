from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from pydantic import BaseModel

from vpscp_agent.db_ops import ConflictError, NotFoundError
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_domain, validate_subdomain


class DomainRecord(BaseModel):
    name: str
    zone_id: str
    created_at: str


def _registered_domains(db: StateDB) -> list[tuple[str, str]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT name, zone_id FROM domain").fetchall()
    return [(row["name"], row["zone_id"]) for row in rows]


def _matching_domain_name(fqdn: str, domains: list[tuple[str, str]]) -> str | None:
    best: str | None = None
    for name, _zone_id in domains:
        if fqdn == name:
            if best is None or len(name) > len(best):
                best = name
            continue
        suffix = f".{name}"
        if not fqdn.endswith(suffix):
            continue
        label = fqdn[: -len(suffix)]
        if "." in label:
            continue
        try:
            validate_subdomain(label)
        except ValueError:
            continue
        if best is None or len(name) > len(best):
            best = name
    return best


def zone_for_fqdn(db: StateDB, fqdn: str) -> str | None:
    domains = _registered_domains(db)
    match = _matching_domain_name(fqdn, domains)
    if match is None:
        return None
    for name, zone_id in domains:
        if name == match:
            return zone_id
    return None


def register_domain(db: StateDB, name: str, zone_id: str) -> DomainRecord:
    validate_domain(name)
    if not zone_id:
        raise ValueError("zone_id must not be empty")
    created_at = datetime.now(UTC).isoformat(timespec="seconds")
    with db.connect() as conn:
        try:
            conn.execute(
                "INSERT INTO domain (name, zone_id, created_at) VALUES (?, ?, ?)",
                (name, zone_id, created_at),
            )
        except sqlite3.IntegrityError as exc:
            raise ConflictError(f"domain already registered: {name!r}") from exc
    return DomainRecord(name=name, zone_id=zone_id, created_at=created_at)


def unregister_domain(db: StateDB, name: str) -> None:
    validate_domain(name)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM hostname WHERE domain = ? LIMIT 1",
            (name,),
        ).fetchone()
        if row is not None:
            raise ConflictError(f"domain still has hostnames: {name!r}")
        cursor = conn.execute("DELETE FROM domain WHERE name = ?", (name,))
        if cursor.rowcount == 0:
            raise NotFoundError(f"domain not registered: {name!r}")


def list_domains(db: StateDB) -> list[DomainRecord]:
    with db.connect() as conn:
        rows = conn.execute("SELECT name, zone_id, created_at FROM domain ORDER BY name").fetchall()
    return [
        DomainRecord(name=row["name"], zone_id=row["zone_id"], created_at=row["created_at"])
        for row in rows
    ]


def domain_for_fqdn(db: StateDB, fqdn: str) -> str | None:
    return _matching_domain_name(fqdn, _registered_domains(db))
