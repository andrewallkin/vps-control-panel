from __future__ import annotations

from pydantic import BaseModel

from vpscp_agent.config import Settings
from vpscp_agent.db_ops import NotFoundError
from vpscp_agent.envfile import EnvFile, _strip_matching_quotes, read_env, write_env_atomic
from vpscp_agent.projects import get_project_row
from vpscp_agent.state import StateDB
from vpscp_agent.validation import (
    safe_project_path,
    validate_env_key,
    validate_env_value,
    validate_project_slug,
)

_MASK_PREFIX = "\u2022" * 4


def mask_env_value(value: str) -> str:
    if len(value) >= 8:
        return _MASK_PREFIX + value[-2:]
    return _MASK_PREFIX


class EnvEntry(BaseModel):
    key: str
    value: str


class EnvEntriesResponse(BaseModel):
    entries: list[EnvEntry]


def _require_project(db: StateDB, slug: str) -> None:
    validate_project_slug(slug)
    if get_project_row(db, slug) is None:
        raise NotFoundError(f"project not found: {slug!r}")


def _first_non_ws_index(line: str) -> int:
    for index, char in enumerate(line):
        if not char.isspace():
            return index
    return len(line)


def validate_env_put_content(content: str) -> None:
    text = content.rstrip("\n")
    seen: set[str] = set()
    for line in text.split("\n"):
        index = _first_non_ws_index(line)
        if index == len(line):
            continue
        if line[index] == "#":
            continue
        if "=" not in line:
            raise ValueError(f"invalid env line: {line!r}")
        key, _, raw_value = line.partition("=")
        validate_env_key(key)
        value = _strip_matching_quotes(raw_value)
        validate_env_value(value)
        if key in seen:
            raise ValueError(f"duplicate env key: {key!r}")
        seen.add(key)


def read_project_env(
    settings: Settings, db: StateDB, slug: str, *, reveal: bool = False
) -> EnvEntriesResponse:
    _require_project(db, slug)
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    envfile = read_env(env_path)
    entries = []
    for key in envfile.keys():  # noqa: SIM118
        value = envfile.get(key) or ""
        if not reveal:
            value = mask_env_value(value)
        entries.append(EnvEntry(key=key, value=value))
    return EnvEntriesResponse(entries=entries)


def write_project_env(settings: Settings, db: StateDB, slug: str, content: str) -> list[str]:
    _require_project(db, slug)
    validate_env_put_content(content)
    envfile = EnvFile.parse(content)
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    write_env_atomic(env_path, envfile)
    return envfile.keys()


def patch_project_env(
    settings: Settings,
    db: StateDB,
    slug: str,
    *,
    set_values: dict[str, str],
    unset_keys: list[str],
) -> None:
    _require_project(db, slug)
    if not set_values and not unset_keys:
        raise ValueError("at least one set or unset is required")
    overlap = set(set_values) & set(unset_keys)
    if overlap:
        raise ValueError(f"key cannot be in both set and unset: {sorted(overlap)!r}")
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    envfile = read_env(env_path)
    if set_values:
        envfile.set_many(set_values)
    if unset_keys:
        envfile.unset_many(unset_keys)
    write_env_atomic(env_path, envfile)
