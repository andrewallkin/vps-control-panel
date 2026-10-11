import ipaddress
import re
from typing import Annotated

import psutil
from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, field_validator

from vpscp_agent import audit
from vpscp_agent.domains import DomainRecord, list_domains, register_domain, unregister_domain
from vpscp_agent.hostnames import allocate_port, list_ports, release_ports
from vpscp_agent.state import StateDB
from vpscp_agent.validation import DomainName, EnvKey, Slug

router = APIRouter(tags=["server"])

_ACME_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _listening_ports() -> set[int]:
    ports: set[int] = set()
    for conn in psutil.net_connections(kind="tcp"):
        if conn.status == psutil.CONN_LISTEN and conn.laddr:
            ports.add(conn.laddr.port)
    return ports


def _get_setting(db: StateDB, key: str) -> str | None:
    with db.connect() as conn:
        row = conn.execute("SELECT value FROM agent_setting WHERE key = ?", (key,)).fetchone()
    return None if row is None else row["value"]


def _set_settings(
    db: StateDB,
    *,
    public_ipv4: str | None = None,
    acme_email: str | None = None,
    update_public_ipv4: bool = False,
    update_acme_email: bool = False,
) -> None:
    with db.connect() as conn:
        if update_public_ipv4:
            if public_ipv4 is None:
                conn.execute("DELETE FROM agent_setting WHERE key = ?", ("public_ipv4",))
            else:
                conn.execute(
                    "INSERT INTO agent_setting (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    ("public_ipv4", public_ipv4),
                )
        if update_acme_email:
            if acme_email is None:
                conn.execute("DELETE FROM agent_setting WHERE key = ?", ("acme_email",))
            else:
                conn.execute(
                    "INSERT INTO agent_setting (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    ("acme_email", acme_email),
                )


class ServerSettings(BaseModel):
    public_ipv4: str | None = None
    acme_email: str | None = None


class ServerSettingsUpdate(BaseModel):
    public_ipv4: str | None = None
    acme_email: str | None = None

    @field_validator("public_ipv4")
    @classmethod
    def check_public_ipv4(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ipaddress.IPv4Address(value)
        except ipaddress.AddressValueError as exc:
            raise ValueError(f"invalid public_ipv4: {value!r}") from exc
        return value

    @field_validator("acme_email")
    @classmethod
    def check_acme_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not _ACME_EMAIL_RE.fullmatch(value):
            raise ValueError(f"invalid acme_email: {value!r}")
        return value


class RegisterDomainBody(BaseModel):
    name: DomainName
    zone_id: str


class AllocatePortBody(BaseModel):
    owner: Slug
    env_var: EnvKey


class ReleasePortsBody(BaseModel):
    owner: Slug


@router.get("/v1/server/settings")
def get_server_settings(request: Request) -> ServerSettings:
    db = request.app.state.db
    return ServerSettings(
        public_ipv4=_get_setting(db, "public_ipv4"),
        acme_email=_get_setting(db, "acme_email"),
    )


@router.put("/v1/server/settings")
def put_server_settings(body: ServerSettingsUpdate, request: Request) -> ServerSettings:
    db = request.app.state.db
    fields_set = body.model_fields_set
    params = {key: getattr(body, key) for key in fields_set}
    with audit.audited(db, "server.settings.update", params):
        _set_settings(
            db,
            public_ipv4=body.public_ipv4,
            acme_email=body.acme_email,
            update_public_ipv4="public_ipv4" in fields_set,
            update_acme_email="acme_email" in fields_set,
        )
    return ServerSettings(
        public_ipv4=_get_setting(db, "public_ipv4"),
        acme_email=_get_setting(db, "acme_email"),
    )


@router.get("/v1/domains")
def get_domains(request: Request) -> list[DomainRecord]:
    return list_domains(request.app.state.db)


@router.post("/v1/domains", status_code=201)
def post_domain(body: RegisterDomainBody, request: Request) -> DomainRecord:
    db = request.app.state.db
    params = {"name": body.name, "zone_id": body.zone_id}
    with audit.audited(db, "domain.register", params):
        return register_domain(db, body.name, body.zone_id)


@router.delete("/v1/domains/{name}", status_code=204)
def delete_domain(name: DomainName, request: Request) -> Response:
    db = request.app.state.db
    params = {"name": name}
    with audit.audited(db, "domain.unregister", params):
        unregister_domain(db, name)
    return Response(status_code=204)


@router.get("/v1/ports")
def get_ports(request: Request, owner: Annotated[Slug, Query()]) -> list[dict[str, int | str]]:
    return list_ports(request.app.state.db, owner)


@router.post("/v1/ports/allocate")
def post_allocate_port(body: AllocatePortBody, request: Request) -> dict[str, int]:
    db = request.app.state.db
    params = {"owner": body.owner, "env_var": body.env_var}
    with audit.audited(db, "port.allocate", params):
        port = allocate_port(
            db,
            body.owner,
            body.env_var,
            listening_ports=_listening_ports,
        )
    return {"port": port}


@router.post("/v1/ports/release", status_code=204)
def post_release_ports(body: ReleasePortsBody, request: Request) -> Response:
    db = request.app.state.db
    params = {"owner": body.owner}
    with audit.audited(db, "port.release", params):
        release_ports(db, body.owner)
    return Response(status_code=204)
