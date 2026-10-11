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

RESERVED_PROJECT_SLUGS = frozenset({"panel", "vpscp-panel", "vpscp"})

_REPO_URL_SSH_RE = re.compile(
    r"^git@github.com:([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})\.git$"
)
_REPO_URL_HTTPS_RE = re.compile(
    r"^https://github.com/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})(\.git)?$"
)
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")
_COMPOSE_FILE_RE = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")


def validate_project_slug(value: str) -> str:
    validate_slug(value)
    if value in RESERVED_PROJECT_SLUGS:
        raise ValueError(f"reserved project slug: {value!r}")
    return value


def validate_repo_url(value: str) -> str:
    if not _REPO_URL_SSH_RE.fullmatch(value) and not _REPO_URL_HTTPS_RE.fullmatch(value):
        raise ValueError(f"invalid repo_url: {value!r}")
    return value


def _reject_path_segments(value: str, kind: str) -> None:
    if ".." in value:
        raise ValueError(f"invalid {kind}: {value!r}")
    if value.startswith(("-", "/")):
        raise ValueError(f"invalid {kind}: {value!r}")
    if "//" in value or value.endswith("/"):
        raise ValueError(f"invalid {kind}: {value!r}")
    for segment in value.split("/"):
        if segment == "":
            raise ValueError(f"invalid {kind}: {value!r}")


def validate_branch(value: str) -> str:
    if not _BRANCH_RE.fullmatch(value):
        raise ValueError(f"invalid branch: {value!r}")
    _reject_path_segments(value, "branch")
    return value


def validate_compose_file(value: str) -> str:
    if not _COMPOSE_FILE_RE.fullmatch(value):
        raise ValueError(f"invalid compose_file: {value!r}")
    _reject_path_segments(value, "compose_file")
    return value


def validate_deploy_mode(value: str) -> str:
    if value not in ("image", "build"):
        raise ValueError(f"invalid deploy_mode: {value!r}")
    return value


def is_ssh_repo_url(repo_url: str) -> bool:
    return repo_url.startswith("git@github.com:")


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
    apps_root = apps_dir.resolve()
    base = (apps_dir / slug).resolve()
    if base != apps_root and apps_root not in base.parents:
        raise ValueError(f"path escapes project directory: {relative or slug!r}")
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
