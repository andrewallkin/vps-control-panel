from __future__ import annotations

import os
import re
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from vpscp_agent.commands import Runner
from vpscp_agent.config import Settings
from vpscp_agent.pg import Psql
from vpscp_agent.state import StateDB
from vpscp_agent.validation import validate_slug

DUMP_NAME_RE = re.compile(r"^\d{8}T\d{6}Z\.dump$")


class DumpInfo(BaseModel):
    name: str
    size_bytes: int
    created_at: datetime


def _dump_name_from_now() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".dump"


def _info_from_path(path: Path) -> DumpInfo:
    stem = path.name.removesuffix(".dump")
    created_at = datetime.strptime(stem, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    return DumpInfo(name=path.name, size_bytes=path.stat().st_size, created_at=created_at)


def _attachment_db_name(db: StateDB, slug: str) -> str:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT db_name FROM db_attachment WHERE slug = ? LIMIT 1",
            (slug,),
        ).fetchone()
    if row is None:
        raise ValueError(f"no attachment for slug: {slug!r}")
    return row["db_name"]


def _prune_dumps(dump_dir: Path, *, keep: int) -> None:
    paths = [p for p in dump_dir.glob("*.dump") if DUMP_NAME_RE.fullmatch(p.name)]
    paths.sort(key=lambda p: p.name)
    for path in paths[:-keep]:
        path.unlink(missing_ok=True)


def dump_project(
    settings: Settings,
    psql: Psql,
    runner: Runner,
    db: StateDB,
    *,
    slug: str,
    keep: int = 5,
) -> DumpInfo:
    validate_slug(slug)
    db_name = _attachment_db_name(db, slug)
    dump_dir = settings.dumps_dir / slug
    dump_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(dump_dir, 0o700)

    name = _dump_name_from_now()
    path = dump_dir / name
    admin = psql.admin_user()
    args = [
        "docker",
        "exec",
        settings.pg_container,
        "pg_dump",
        "-Fc",
        "-U",
        admin,
        "-d",
        db_name,
    ]
    runner.stream_to_file(args, path, 120)
    os.chmod(path, 0o600)
    _prune_dumps(dump_dir, keep=keep)
    return _info_from_path(path)


def list_dumps(settings: Settings, slug: str) -> list[DumpInfo]:
    validate_slug(slug)
    dump_dir = settings.dumps_dir / slug
    if not dump_dir.is_dir():
        return []
    out = [_info_from_path(p) for p in dump_dir.glob("*.dump") if DUMP_NAME_RE.fullmatch(p.name)]
    out.sort(key=lambda info: info.name, reverse=True)
    return out


def dump_path(settings: Settings, slug: str, name: str) -> Path:
    validate_slug(slug)
    if not DUMP_NAME_RE.fullmatch(name):
        raise ValueError(f"invalid dump name: {name!r}")
    base = (settings.dumps_dir / slug).resolve()
    path = (base / name).resolve()
    if path.parent != base:
        raise ValueError(f"invalid dump name: {name!r}")
    return path
