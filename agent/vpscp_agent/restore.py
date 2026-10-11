from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from vpscp_agent.config import Settings
from vpscp_agent.db_ops import list_databases, list_roles
from vpscp_agent.envfile import read_env
from vpscp_agent.pg import Psql, quote_ident
from vpscp_agent.validation import safe_project_path

if TYPE_CHECKING:
    from vpscp_agent.commands import Runner
    from vpscp_agent.jobs import JobContext
    from vpscp_agent.state import StateDB

_CLUSTER_EMPTY_SQL = """
SELECT 1 FROM pg_database d
WHERE NOT d.datistemplate AND d.datname <> 'postgres' LIMIT 1;
""".strip()

_MAX_CHUNK_BYTES = 16 * 1024 * 1024
_RESERVE_BYTES = 1024**3
_PG_HEADER = "PostgreSQL database cluster dump"
_ROLE_RE = re.compile(r"^CREATE ROLE (\S+);")
_DATABASE_RE = re.compile(r"^CREATE DATABASE (\S+) ")

ALLOWED_SUFFIXES = (".sql.gz", ".sql")


@dataclass(frozen=True)
class DumpScan:
    kind: str
    header_ok: bool
    databases: list[str]
    roles: list[str]


@dataclass(frozen=True)
class UploadInfo:
    id: str
    filename: str
    size: int
    kind: str
    header_ok: bool
    databases: list[str]
    roles: list[str]


@dataclass
class UploadMeta:
    filename: str
    size: int
    received: int
    created_at: str


def validate_dump(path: Path, *, filename: str | None = None) -> DumpScan:
    name = filename if filename is not None else path.name
    if name.endswith(".sql.gz"):
        kind = "gzip"
        try:
            with gzip.open(path, "rb") as gz:
                lines = _read_line_stream(gz)
        except (EOFError, gzip.BadGzipFile) as exc:
            raise ValueError("corrupt gzip") from exc
    elif name.endswith(".sql"):
        kind = "plain"
        with path.open("rb") as f:
            lines = _read_line_stream(f)
    else:
        raise ValueError("unsupported dump extension")

    header_ok = _scan_header(lines)
    if not header_ok:
        raise ValueError("not a pg_dumpall file")

    roles: list[str] = []
    databases: list[str] = []
    for line in lines:
        m = _ROLE_RE.match(line)
        if m:
            roles.append(m.group(1))
            continue
        m = _DATABASE_RE.match(line)
        if m:
            databases.append(m.group(1))

    return DumpScan(kind=kind, header_ok=header_ok, databases=databases, roles=roles)


def _read_line_stream(stream) -> list[str]:
    lines: list[str] = []
    while True:
        raw = stream.readline()
        if not raw:
            break
        lines.append(raw.decode("utf-8", errors="replace").rstrip("\n\r"))
    return lines


def _scan_header(lines: list[str]) -> bool:
    for line in lines[:50]:
        if _PG_HEADER in line:
            return True
    return False


class UploadStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._dir = settings.restore_dir

    def create(self, filename: str, size: int) -> str:
        if not filename.endswith((".sql.gz", ".sql")):
            raise ValueError("filename must end with .sql.gz or .sql")
        if size > self._settings.max_upload_bytes:
            raise ValueError("upload exceeds max_upload_bytes")
        self._dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        usage = shutil.disk_usage(self._dir)
        if size > usage.free - _RESERVE_BYTES:
            raise ValueError("insufficient disk space")
        self._purge_stale()
        upload_id = uuid.uuid4().hex
        part_path = self._part_path(upload_id)
        part_path.touch(mode=0o600)
        os.chmod(part_path, 0o600)
        meta = UploadMeta(
            filename=filename,
            size=size,
            received=0,
            created_at=datetime.now(UTC).isoformat(),
        )
        self._write_meta(upload_id, meta)
        return upload_id

    def append(self, upload_id: str, offset: int, chunk: bytes) -> int:
        if len(chunk) > _MAX_CHUNK_BYTES:
            raise ValueError("chunk exceeds 16 MiB")
        meta = self._load_meta(upload_id)
        if offset != meta.received:
            raise ValueError(f"offset mismatch: expected {meta.received}")
        if offset + len(chunk) > meta.size:
            raise ValueError("chunk exceeds declared size")
        part_path = self._part_path(upload_id)
        with part_path.open("r+b") as f:
            f.seek(offset)
            f.write(chunk)
        meta.received = offset + len(chunk)
        self._write_meta(upload_id, meta)
        return meta.received

    def complete(self, upload_id: str, sha256: str) -> UploadInfo:
        meta = self._load_meta(upload_id)
        if meta.received != meta.size:
            raise ValueError("upload incomplete")
        part_path = self._part_path(upload_id)
        data = part_path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != sha256.lower():
            raise ValueError("sha256 mismatch")
        scan = validate_dump(part_path, filename=meta.filename)
        suffix = ".sql.gz" if meta.filename.endswith(".sql.gz") else ".sql"
        final_path = self._dir / f"{upload_id}{suffix}"
        os.replace(part_path, final_path)
        os.chmod(final_path, 0o600)
        return UploadInfo(
            id=upload_id,
            filename=meta.filename,
            size=meta.size,
            kind=scan.kind,
            header_ok=scan.header_ok,
            databases=scan.databases,
            roles=scan.roles,
        )

    def get(self, upload_id: str) -> UploadMeta:
        return self._load_meta(upload_id)

    def completed_path(self, upload_id: str) -> Path:
        meta = self._load_meta(upload_id)
        if meta.received != meta.size:
            raise ValueError("upload incomplete")
        if meta.filename.endswith(".sql.gz"):
            path = self._dir / f"{upload_id}.sql.gz"
        elif meta.filename.endswith(".sql"):
            path = self._dir / f"{upload_id}.sql"
        else:
            raise ValueError("unsupported dump extension")
        if not path.is_file():
            raise ValueError("upload not validated")
        return path

    def delete(self, upload_id: str) -> None:
        meta = self._load_meta(upload_id)
        for path in self._artifact_paths(upload_id, meta.filename):
            if path.exists():
                path.unlink()
        meta_path = self._meta_path(upload_id)
        if meta_path.exists():
            meta_path.unlink()

    def _purge_stale(self) -> None:
        cutoff = datetime.now(UTC) - timedelta(hours=24)
        if not self._dir.is_dir():
            return
        for meta_path in self._dir.glob("*.json"):
            try:
                meta = self._read_meta_file(meta_path)
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
            try:
                created = datetime.fromisoformat(meta.created_at)
            except ValueError:
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=UTC)
            if created < cutoff:
                upload_id = meta_path.stem
                for path in self._artifact_paths(upload_id, meta.filename):
                    if path.exists():
                        path.unlink()
                meta_path.unlink()

    def _artifact_paths(self, upload_id: str, filename: str) -> list[Path]:
        paths = [self._part_path(upload_id)]
        if filename.endswith(".sql.gz"):
            paths.append(self._dir / f"{upload_id}.sql.gz")
        elif filename.endswith(".sql"):
            paths.append(self._dir / f"{upload_id}.sql")
        return paths

    def _part_path(self, upload_id: str) -> Path:
        return self._dir / f"{upload_id}.part"

    def _meta_path(self, upload_id: str) -> Path:
        return self._dir / f"{upload_id}.json"

    def _write_meta(self, upload_id: str, meta: UploadMeta) -> None:
        path = self._meta_path(upload_id)
        payload = {
            "filename": meta.filename,
            "size": meta.size,
            "received": meta.received,
            "created_at": meta.created_at,
        }
        path.write_text(json.dumps(payload), encoding="utf-8")
        os.chmod(path, 0o600)

    def _load_meta(self, upload_id: str) -> UploadMeta:
        path = self._meta_path(upload_id)
        if not path.is_file():
            raise ValueError("upload not found")
        return self._read_meta_file(path)

    @staticmethod
    def _read_meta_file(path: Path) -> UploadMeta:
        data = json.loads(path.read_text(encoding="utf-8"))
        return UploadMeta(
            filename=data["filename"],
            size=int(data["size"]),
            received=int(data["received"]),
            created_at=data["created_at"],
        )


def cluster_is_empty(psql: Psql) -> bool:
    return not bool(psql.query_rows(_CLUSTER_EMPTY_SQL))


def reset_admin_password(psql: Psql, settings: Settings) -> None:
    env = read_env(settings.stack_env_path)
    password = env.get("POSTGRES_PASSWORD")
    if password is None:
        raise ValueError("POSTGRES_PASSWORD not set in stack env")
    admin = psql.admin_user()
    user_q = quote_ident(admin)
    sql = f"\\getenv pw VPSCP_PW\nALTER ROLE {user_q} WITH PASSWORD :'pw';\n"
    psql.exec_sql(sql, database="postgres", secrets={"VPSCP_PW": password})


def _compose_file(project_dir: Path) -> bool:
    return (project_dir / "docker-compose.yml").is_file() or (project_dir / "compose.yml").is_file()


def _attachment_slugs(db: StateDB) -> list[str]:
    with db.connect() as conn:
        rows = conn.execute("SELECT DISTINCT slug FROM db_attachment ORDER BY slug").fetchall()
    return [row["slug"] for row in rows]


def _dump_byte_chunks(path: Path) -> Iterator[bytes]:
    if path.name.endswith(".sql.gz"):
        with gzip.open(path, "rb") as gz:
            while True:
                chunk = gz.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
    else:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk


def _safety_dump_path(restore_dir: Path) -> Path:
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return restore_dir / f"safety-{ts}.sql.gz"


def _write_safety_dump(
    settings: Settings,
    psql: Psql,
    runner: Runner,
    restore_dir: Path,
) -> Path:
    restore_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = _safety_dump_path(restore_dir)
    admin = psql.admin_user()
    plain = path.with_suffix("")
    args = [
        "docker",
        "exec",
        settings.pg_container,
        "pg_dumpall",
        "-U",
        admin,
    ]
    runner.stream_to_file(args, plain, 120)
    with plain.open("rb") as src, gzip.open(path, "wb") as dst:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            dst.write(chunk)
    plain.unlink(missing_ok=True)
    os.chmod(path, 0o600)
    return path


def restore_cluster(
    ctx: JobContext,
    *,
    settings: Settings,
    psql: Psql,
    runner: Runner,
    db: StateDB,
    upload_id: str,
) -> dict:
    dump_path = UploadStore(settings).completed_path(upload_id)
    empty = cluster_is_empty(psql)
    stopped_slugs: list[str] = []
    safety_dump: Path | None = None

    if not empty:
        for slug in _attachment_slugs(db):
            project_dir = safe_project_path(settings.apps_dir, slug)
            if not _compose_file(project_dir):
                continue
            args = ["docker", "compose", "-p", slug, "stop"]
            ctx.log(f"compose stop: {slug}")
            runner(args, cwd=project_dir, check=True)
            stopped_slugs.append(slug)

        safety_dump = _write_safety_dump(settings, psql, runner, settings.restore_dir)
        ctx.log(f"safety dump: {safety_dump}")

    admin = psql.admin_user()
    load_args = [
        "docker",
        "exec",
        "-i",
        settings.pg_container,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=0",
        "-U",
        admin,
        "-d",
        "postgres",
    ]
    errors: list[str] = []
    error_count = 0

    def on_line(line: str) -> None:
        nonlocal error_count
        ctx.log(line)
        if "ERROR:" in line:
            error_count += 1
            if len(errors) < 200:
                errors.append(line)

    runner.pipe_through(load_args, _dump_byte_chunks(dump_path), on_line, 120)
    reset_admin_password(psql, settings)

    for slug in stopped_slugs:
        project_dir = safe_project_path(settings.apps_dir, slug)
        args = ["docker", "compose", "-p", slug, "start"]
        ctx.log(f"compose start: {slug}")
        runner(args, cwd=project_dir, check=True)

    databases = list_databases(psql, db)
    roles = list_roles(psql)
    return {
        "databases": [d.model_dump() for d in databases],
        "roles": roles,
        "error_count": error_count,
        "errors": errors,
        "safety_dump": str(safety_dump) if safety_dump is not None else None,
    }
