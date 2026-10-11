import re
from collections.abc import Callable
from pathlib import Path
from typing import Annotated

from pydantic import AfterValidator

SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,38}$")
DNS_LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
ENV_KEY_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
SQL_IDENT_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")
ROUTE_PATH_RE = re.compile(r"^/[A-Za-z0-9/_-]*$")

MIN_PORT = 1024
MAX_PORT = 65535
RESERVED_PORTS = frozenset({5432, 8080})


def _matcher(pattern: re.Pattern[str], kind: str) -> Callable[[str], str]:
    def check(value: str) -> str:
        if not pattern.fullmatch(value):
            raise ValueError(f"invalid {kind}: {value!r}")
        return value

    return check


validate_slug = _matcher(SLUG_RE, "project slug")
validate_domain = _matcher(DOMAIN_RE, "domain")
validate_env_key = _matcher(ENV_KEY_RE, "env key")
validate_sql_ident = _matcher(SQL_IDENT_RE, "SQL identifier")
validate_route_path = _matcher(ROUTE_PATH_RE, "route path")
_validate_dns_label = _matcher(DNS_LABEL_RE, "subdomain")


def validate_subdomain(value: str) -> str:
    if value == "":
        return value
    return _validate_dns_label(value)


def validate_port(value: int) -> int:
    if not MIN_PORT <= value <= MAX_PORT or value in RESERVED_PORTS:
        raise ValueError(f"invalid port: {value}")
    return value


def validate_env_value(value: str) -> str:
    if any(ch in value for ch in ("\n", "\r", "\x00")):
        raise ValueError("env values must not contain newlines or NUL characters")
    return value


def safe_project_path(apps_dir: Path, slug: str, relative: str = "") -> Path:
    validate_slug(slug)
    base = (apps_dir / slug).resolve()
    target = (base / relative).resolve()
    if target != base and base not in target.parents:
        raise ValueError(f"path escapes project directory: {relative!r}")
    return target


Slug = Annotated[str, AfterValidator(validate_slug)]
Subdomain = Annotated[str, AfterValidator(validate_subdomain)]
DomainName = Annotated[str, AfterValidator(validate_domain)]
Port = Annotated[int, AfterValidator(validate_port)]
EnvKey = Annotated[str, AfterValidator(validate_env_key)]
EnvValue = Annotated[str, AfterValidator(validate_env_value)]
SqlIdent = Annotated[str, AfterValidator(validate_sql_ident)]
RoutePath = Annotated[str, AfterValidator(validate_route_path)]
