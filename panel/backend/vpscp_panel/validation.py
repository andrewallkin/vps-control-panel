import re
from typing import Annotated

from pydantic import AfterValidator

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
DNS_LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
_ACME_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,38}$")
SQL_IDENT_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")
ENV_KEY_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
ROUTE_PATH_RE = re.compile(r"^/[A-Za-z0-9/_-]*$")
_GITHUB_OWNER_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_DOCKER_HUB_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")
_SSH_REPO_RE = re.compile(r"^git@github\.com:([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})\.git$")
_HTTPS_REPO_RE = re.compile(
    r"^https://github\.com/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})(\.git)?$"
)
RESERVED_SLUGS = frozenset({"panel", "vpscp-panel", "vpscp"})
_SERVICE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$")
_DOCKER_IMAGE_ENV_RE = re.compile(r"^DOCKER_IMAGE_[A-Z0-9_]+$")
_TAG_PREFIX_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


def validate_domain(value: str) -> str:
    if not DOMAIN_RE.fullmatch(value):
        raise ValueError(f"invalid domain: {value!r}")
    return value


def validate_subdomain(value: str) -> str:
    if value == "":
        return value
    if not DNS_LABEL_RE.fullmatch(value):
        raise ValueError(f"invalid subdomain: {value!r}")
    return value


def validate_acme_email(value: str | None) -> str | None:
    if value is None:
        return None
    if not _ACME_EMAIL_RE.fullmatch(value):
        raise ValueError(f"invalid acme_email: {value!r}")
    return value


def validate_slug(value: str) -> str:
    if not SLUG_RE.fullmatch(value):
        raise ValueError(f"invalid slug: {value!r}")
    if value in RESERVED_SLUGS:
        raise ValueError(f"reserved slug: {value!r}")
    return value


def validate_sql_ident(value: str) -> str:
    if not SQL_IDENT_RE.fullmatch(value):
        raise ValueError(f"invalid sql identifier: {value!r}")
    return value


def validate_env_key(value: str) -> str:
    if not ENV_KEY_RE.fullmatch(value):
        raise ValueError(f"invalid env key: {value!r}")
    return value


def validate_route_path(value: str) -> str:
    if not ROUTE_PATH_RE.fullmatch(value):
        raise ValueError(f"invalid route path: {value!r}")
    return value


def validate_branch(value: str) -> str:
    if not _BRANCH_RE.fullmatch(value) or ".." in value or value.startswith("-"):
        raise ValueError(f"invalid branch: {value!r}")
    return value


def validate_repo_url(value: str) -> str:
    if _SSH_REPO_RE.fullmatch(value) or _HTTPS_REPO_RE.fullmatch(value):
        return value
    raise ValueError(f"invalid repo url: {value!r}")


def validate_docker_hub_repo(value: str) -> str:
    if not _DOCKER_HUB_REPO_RE.fullmatch(value):
        raise ValueError(f"invalid docker hub repo: {value!r}")
    return value


def validate_service_name(value: str) -> str:
    if not _SERVICE_NAME_RE.fullmatch(value):
        raise ValueError(f"invalid service name: {value!r}")
    return value


def validate_docker_image_env(value: str) -> str:
    if not _DOCKER_IMAGE_ENV_RE.fullmatch(value):
        raise ValueError(f"invalid docker image env var: {value!r}")
    return value


def validate_tag_prefix(value: str) -> str:
    if not _TAG_PREFIX_RE.fullmatch(value):
        raise ValueError(f"invalid tag prefix: {value!r}")
    return value


def tag_prefix_from_docker_image_env(env_var: str) -> str | None:
    if not _DOCKER_IMAGE_ENV_RE.fullmatch(env_var):
        return None
    raw = env_var[len("DOCKER_IMAGE_") :]
    prefix = raw.lower().replace("_", "-")
    if not _TAG_PREFIX_RE.fullmatch(prefix):
        return None
    return prefix


DomainName = Annotated[str, AfterValidator(validate_domain)]
Subdomain = Annotated[str, AfterValidator(validate_subdomain)]
Slug = Annotated[str, AfterValidator(validate_slug)]
SqlIdent = Annotated[str, AfterValidator(validate_sql_ident)]
EnvKey = Annotated[str, AfterValidator(validate_env_key)]
RoutePath = Annotated[str, AfterValidator(validate_route_path)]
BranchName = Annotated[str, AfterValidator(validate_branch)]
RepoUrl = Annotated[str, AfterValidator(validate_repo_url)]
ServiceName = Annotated[str, AfterValidator(validate_service_name)]
DockerImageEnv = Annotated[str, AfterValidator(validate_docker_image_env)]
TagPrefix = Annotated[str, AfterValidator(validate_tag_prefix)]
