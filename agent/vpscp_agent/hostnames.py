from __future__ import annotations

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
) -> int:
    validate_slug(owner)
    validate_env_key(env_var)
    listen = listening_ports if listening_ports is not None else _default_listening_ports

    with db.connect() as conn:
        row = conn.execute(
            "SELECT port FROM port_allocation WHERE owner = ? AND env_var = ?",
            (owner, env_var),
        ).fetchone()
        if row is not None:
            return int(row["port"])

        taken = {
            int(r["port"]) for r in conn.execute("SELECT port FROM port_allocation").fetchall()
        }
        listening = listen()
        for port in range(PORT_POOL_START, PORT_POOL_END + 1):
            if port in RESERVED_POOL_PORTS:
                continue
            if port in taken or port in listening:
                continue
            conn.execute(
                "INSERT INTO port_allocation (port, owner, env_var) VALUES (?, ?, ?)",
                (port, owner, env_var),
            )
            return port
    raise ConflictError("no free ports in pool")


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
