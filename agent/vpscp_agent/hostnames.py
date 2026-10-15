from __future__ import annotations

import sqlite3
from collections.abc import Callable

import psutil

from vpscp_agent.db_ops import ConflictError
from vpscp_agent.domains import domain_for_fqdn, zone_for_fqdn
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_env_key, validate_slug

type ListeningPorts = Callable[[], set[int]]

PORT_POOL_START = 10000
PORT_POOL_END = 19999
RESERVED_POOL_PORTS = frozenset({5432, 8080})


def _default_listening_ports() -> set[int]:
    ports: set[int] = set()
    for conn in psutil.net_connections(kind="tcp"):
        if conn.status == psutil.CONN_LISTEN and conn.laddr:
            ports.add(conn.laddr.port)
    return ports


def claim_hostnames(db: StateDB, site: str, fqdns: list[str]) -> None:
    validate_slug(site)
    normalized = sorted(set(fqdns))
    for fqdn in normalized:
        if zone_for_fqdn(db, fqdn) is None:
            raise ValueError(f"fqdn not under a registered domain: {fqdn!r}")

    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for fqdn in normalized:
                row = conn.execute(
                    "SELECT site FROM hostname WHERE fqdn = ?",
                    (fqdn,),
                ).fetchone()
                if row is not None and row["site"] != site:
                    raise ConflictError(f"hostname already claimed: {fqdn!r}")

            conn.execute("DELETE FROM hostname WHERE site = ?", (site,))
            for fqdn in normalized:
                domain = domain_for_fqdn(db, fqdn)
                assert domain is not None
                conn.execute(
                    "INSERT INTO hostname (fqdn, site, domain) VALUES (?, ?, ?)",
                    (fqdn, site, domain),
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise


def release_site(db: StateDB, site: str) -> None:
    validate_slug(site)
    with db.connect() as conn:
        conn.execute("DELETE FROM hostname WHERE site = ?", (site,))


def allocate_port(
    db: StateDB,
    owner: str,
    env_var: str,
    *,
    listening_ports: ListeningPorts | None = None,
    port: int | None = None,
) -> int:
    validate_slug(owner)
    validate_env_key(env_var)
    listen = listening_ports if listening_ports is not None else _default_listening_ports

    if port is not None:
        return _allocate_explicit_port(db, owner, env_var, port, listen)

    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT port FROM port_allocation WHERE owner = ? AND env_var = ?",
                (owner, env_var),
            ).fetchone()
            if row is not None:
                conn.execute("COMMIT")
                return int(row["port"])

            taken = {
                int(r["port"]) for r in conn.execute("SELECT port FROM port_allocation").fetchall()
            }
            listening = listen()
            for candidate in range(PORT_POOL_START, PORT_POOL_END + 1):
                if candidate in RESERVED_POOL_PORTS:
                    continue
                if candidate in taken or candidate in listening:
                    continue
                try:
                    conn.execute(
                        "INSERT INTO port_allocation (port, owner, env_var) VALUES (?, ?, ?)",
                        (candidate, owner, env_var),
                    )
                except sqlite3.IntegrityError:
                    row = conn.execute(
                        "SELECT port FROM port_allocation WHERE owner = ? AND env_var = ?",
                        (owner, env_var),
                    ).fetchone()
                    if row is not None:
                        conn.execute("COMMIT")
                        return int(row["port"])
                    taken.add(candidate)
                    continue
                conn.execute("COMMIT")
                return candidate
            conn.execute("ROLLBACK")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    raise ConflictError("no free ports in pool")


def _allocate_explicit_port(
    db: StateDB,
    owner: str,
    env_var: str,
    requested: int,
    listen: ListeningPorts,
) -> int:
    if not 1 <= requested <= 65535:
        raise ValueError(f"port out of range: {requested}")
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT port FROM port_allocation WHERE owner = ? AND env_var = ?",
                (owner, env_var),
            ).fetchone()
            if row is not None and int(row["port"]) == requested:
                conn.execute("COMMIT")
                return requested
            holder = conn.execute(
                "SELECT owner, env_var FROM port_allocation WHERE port = ?",
                (requested,),
            ).fetchone()
            if holder is not None:
                raise ConflictError(
                    f"port {requested} is allocated to {holder['owner']} ({holder['env_var']})"
                )
            if requested in listen():
                raise ConflictError(f"port {requested} is already listening on the host")
            if row is not None:
                conn.execute(
                    "UPDATE port_allocation SET port = ? WHERE owner = ? AND env_var = ?",
                    (requested, owner, env_var),
                )
            else:
                conn.execute(
                    "INSERT INTO port_allocation (port, owner, env_var) VALUES (?, ?, ?)",
                    (requested, owner, env_var),
                )
            conn.execute("COMMIT")
            return requested
        except Exception:
            conn.execute("ROLLBACK")
            raise


def list_used_ports(
    db: StateDB,
    *,
    listening_ports: ListeningPorts | None = None,
) -> list[dict[str, int | str | None]]:
    listen = listening_ports if listening_ports is not None else _default_listening_ports
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT port, owner, env_var FROM port_allocation ORDER BY port"
        ).fetchall()
    used: dict[int, dict[str, int | str | None]] = {
        int(row["port"]): {
            "port": int(row["port"]),
            "owner": row["owner"],
            "env_var": row["env_var"],
        }
        for row in rows
    }
    for port in listen():
        used.setdefault(port, {"port": port, "owner": None, "env_var": None})
    return sorted(used.values(), key=lambda item: int(item["port"]))


def release_ports(db: StateDB, owner: str) -> None:
    validate_slug(owner)
    with db.connect() as conn:
        conn.execute("DELETE FROM port_allocation WHERE owner = ?", (owner,))


def list_ports(db: StateDB, owner: str) -> list[dict[str, int | str]]:
    validate_slug(owner)
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT port, env_var FROM port_allocation WHERE owner = ? ORDER BY port",
            (owner,),
        ).fetchall()
    return [{"port": int(row["port"]), "env_var": row["env_var"]} for row in rows]
