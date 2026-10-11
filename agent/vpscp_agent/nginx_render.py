from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import AfterValidator, BaseModel, Field, model_validator

from vpscp_agent.validation import DomainName, RoutePath

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
FQDN_RE = re.compile(rf"^{_LABEL}(?:\.{_LABEL})+$")


def validate_fqdn(value: str) -> str:
    if value != value.lower():
        raise ValueError(f"invalid fqdn: {value!r}")
    if not FQDN_RE.fullmatch(value):
        raise ValueError(f"invalid fqdn: {value!r}")
    return value


def validate_upstream_port(value: int) -> int:
    if not 1 <= value <= 65535:
        raise ValueError(f"invalid port: {value}")
    return value


Fqdn = Annotated[str, AfterValidator(validate_fqdn)]
UpstreamPort = Annotated[int, AfterValidator(validate_upstream_port)]


class RouteSpec(BaseModel):
    path: RoutePath = "/"
    port: UpstreamPort
    max_body_mb: int = Field(25, ge=1, le=10240)
    read_timeout_s: int = Field(60, ge=1, le=3600)
    send_timeout_s: int = Field(60, ge=1, le=3600)
    streaming: bool = False
    websocket: bool = False
    pass_authorization: bool = False


class HostnameSpec(BaseModel):
    fqdn: Fqdn
    domain: DomainName
    kind: Literal["primary", "alias", "redirect"]


class SiteSpec(BaseModel):
    site_id: str
    hostnames: list[HostnameSpec]
    routes: list[RouteSpec]
    panel: bool = False

    @model_validator(mode="after")
    def _check_hostnames_and_routes(self) -> Self:
        primaries = [hostname for hostname in self.hostnames if hostname.kind == "primary"]
        if len(primaries) != 1:
            raise ValueError("exactly one primary hostname required")
        if len(self.routes) < 1:
            raise ValueError("at least one route required")
        paths = [route.path for route in self.routes]
        if len(paths) != len(set(paths)):
            raise ValueError("route paths must be unique")
        return self


def _primary_fqdn(spec: SiteSpec) -> str:
    for hostname in spec.hostnames:
        if hostname.kind == "primary":
            return hostname.fqdn
    raise AssertionError("primary missing")


def _sorted_routes(routes: list[RouteSpec]) -> list[RouteSpec]:
    return sorted(routes, key=lambda route: (len(route.path), route.path), reverse=True)


def _http_redirect_target(hostname: HostnameSpec, primary_fqdn: str) -> str:
    if hostname.kind == "redirect":
        return primary_fqdn
    return hostname.fqdn


@lru_cache
def _jinja_env() -> Environment:
    template_dir = Path(__file__).resolve().parent / "templates" / "nginx"
    return Environment(
        loader=FileSystemLoader(template_dir),
        autoescape=select_autoescape(enabled_extensions=()),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )


def render_site(spec: SiteSpec) -> str:
    primary = _primary_fqdn(spec)
    template = _jinja_env().get_template("site.conf.j2")
    return template.render(
        site_id=spec.site_id,
        primary_fqdn=primary,
        hostnames=spec.hostnames,
        routes=_sorted_routes(spec.routes),
        panel=spec.panel,
        http_redirect_target=_http_redirect_target,
    )


def render_default_server() -> str:
    return _jinja_env().get_template("default.conf.j2").render()


def render_cloudflare_realip(ipv4_cidrs: list[str], ipv6_cidrs: list[str]) -> str:
    return (
        _jinja_env()
        .get_template("realip.conf.j2")
        .render(
            ipv4_cidrs=ipv4_cidrs,
            ipv6_cidrs=ipv6_cidrs,
        )
    )
