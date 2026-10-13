from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO

from vpscp_agent.config import Settings
from vpscp_agent.db_ops import list_databases, list_roles
from vpscp_agent.envfile import read_env
from vpscp_agent.pg import Psql, quote_ident
from vpscp_agent.validation import safe_project_path

if TYPE_CHECKING:
    from vpscp_agent.commands import Runner
    from vpscp_agent.jobs import JobContext
    from vpscp_agent.state import StateDB

_CLUSTER_DBS_SQL = """
SELECT d.datname FROM pg_database d
WHERE NOT d.datistemplate AND d.datname <> 'postgres' ORDER BY 1;
""".strip()

_CLUSTER_ROLES_SQL = """
SELECT r.rolname FROM pg_roles r
WHERE r.rolname !~ '^pg_' ORDER BY 1;
""".strip()

_MAX_CHUNK_BYTES = 16 * 1024 * 1024
_RESERVE_BYTES = 1024**3
_PG_HEADER = "PostgreSQL database cluster dump"
_ROLE_RE = re.compile(r"^CREATE ROLE (\S+);")
_DATABASE_RE = re.compile(r"^CREATE DATABASE (\S+) ")
_UPLOAD_ID_RE = re.compile(r"^[0-9a-f]{32}$")

ALLOWED_SUFFIXES = (".sql.gz", ".sql", ".sql.gz.age", ".sql.age")


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


def _validate_upload_id(upload_id: str) -> None:
    if _UPLOAD_ID_RE.fullmatch(upload_id) is None:
        raise ValueError("invalid upload id")


def validate_dump(
    path: Path, *, filename: str | None = None, passphrase: str | None = None
) -> DumpScan:
    name = filename if filename is not None else path.name
    lowered = name.lower()
    if lowered.endswith((".sql.gz", ".sql.gz.age")):
        kind = "gzip"
    elif lowered.endswith((".sql", ".sql.age")):
        kind = "plain"
    else:
        raise ValueError("unsupported dump extension")

    try:
        with _open_dump_sql_stream(path, passphrase=passphrase, name=name) as stream:
            header_ok, roles, databases = _scan_dump_stream(stream)
    except (EOFError, gzip.BadGzipFile) as exc:
        if kind == "gzip":
            raise ValueError("corrupt gzip") from exc
        raise

    if not header_ok:
        raise ValueError(
            "not a pg_dumpall cluster dump (single-database pg_dump/phpMyAdmin exports are not supported)"
        )

    return DumpScan(kind=kind, header_ok=header_ok, databases=databases, roles=roles)


def _scan_dump_stream(stream) -> tuple[bool, list[str], list[str]]:
    roles: list[str] = []
    databases: list[str] = []
    header_ok = False
    header_lines = 0
    for line in _iter_dump_lines(stream):
        if header_lines < 50:
            if _PG_HEADER in line:
                header_ok = True
            header_lines += 1
        m = _ROLE_RE.match(line)
        if m:
            roles.append(m.group(1))
            continue
        m = _DATABASE_RE.match(line)
        if m:
            databases.append(m.group(1))
    return header_ok, roles, databases


def _iter_dump_lines(stream) -> Iterator[str]:
    while True:
        raw = stream.readline()
        if not raw:
            break
        yield raw.decode("utf-8", errors="replace").rstrip("\n\r")


# psql meta-commands a real pg_dumpall legitimately uses.
# psql meta-commands a real pg_dumpall legitimately uses, plus the bare "\."
# COPY data terminator that ends every COPY ... FROM stdin section.
_DUMP_META_ALLOWED = ("\\connect", "\\c ", "\\restrict", "\\unrestrict", "\\echo", "\\pset")
_COPY_TERMINATOR = "\\."
_COPY_PROGRAM_RE = re.compile(r"\bcopy\b.*\b(?:TO|FROM)\s+PROGRAM\b", re.IGNORECASE)
_SUPERUSER_GRANT_RE = re.compile(
    r"\b(?:CREATE|ALTER)\s+ROLE\s+(\"?)([\w.-]+)\1[^;]*\bSUPERUSER\b", re.IGNORECASE
)


def _stored_suffix(filename: str) -> str:
    lowered = filename.lower()
    for suffix in (".sql.gz.age", ".sql.age", ".sql.gz", ".sql"):
        if lowered.endswith(suffix):
            return suffix
    raise ValueError("unsupported dump extension")


def _dump_passphrase(settings) -> str | None:
    from vpscp_agent.envfile import read_env

    return read_env(settings.stack_env_path).get("BACKUP_ARCHIVE_PASSPHRASE") or None


@contextmanager
def _open_dump_sql_stream(
    path: Path, *, passphrase: str | None, name: str | None = None
) -> Iterator[BinaryIO]:
    """Open a dump as a streaming reader of decompressed SQL.

    Cutover dumps are multi-GB decompressed; the SQL must stream (gzip
    member reads) and never be materialized whole. Backups uploaded to GCS
    are age-encrypted — pyrage decrypt is bytes-in/bytes-out, so the inner
    payload is staged to a temp file and then streamed from disk; the
    decompressed SQL still never lands in RAM.
    """
    display = name if name is not None else path.name
    if display.endswith(".age"):
        if not passphrase:
            raise ValueError(
                "dump is age-encrypted but BACKUP_ARCHIVE_PASSPHRASE is not configured"
            )
        from pyrage import passphrase as pyrage_passphrase

        try:
            inner = pyrage_passphrase.decrypt(path.read_bytes(), passphrase)
        except Exception as exc:
            raise ValueError("dump decryption failed: wrong passphrase?") from exc
        tmp_name: str | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, dir=path.parent, suffix=".inner") as tmp:
                tmp.write(inner)
                tmp_name = tmp.name
            del inner
            with _open_plain_or_gzip(Path(tmp_name), display) as stream:
                yield stream
        finally:
            if tmp_name is not None:
                os.unlink(tmp_name)
    else:
        with _open_plain_or_gzip(path, display) as stream:
            yield stream


def _open_plain_or_gzip(path: Path, display: str) -> BinaryIO:
    if display.lower().endswith((".sql.gz", ".sql.gz.age")):
        return gzip.open(path, "rb")
    return path.open("rb")


def _scan_for_dangerous_statements(
    path: Path, *, admin: str, passphrase: str | None = None, name: str | None = None
) -> None:
    r"""Reject dumps that would execute OS commands or persist superusers.

    A restore runs as the postgres superuser via psql, so a crafted dump is
    executable code. Real pg_dumpall output only uses \connect/\restrict/
    \unrestrict/\echo/\pset meta-commands — everything else is refused.
    """
    violations: list[str] = []
    with _open_dump_sql_stream(path, passphrase=passphrase, name=name) as stream:
        for lineno, line in enumerate(_iter_dump_lines(stream), start=1):
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("--"):
                continue
            if stripped.startswith("\\"):
                meta = stripped.split()[0].rstrip(";")
                allowed = stripped == _COPY_TERMINATOR or any(
                    stripped.startswith(prefix) for prefix in _DUMP_META_ALLOWED
                )
                if not allowed:
                    violations.append(f"line {lineno}: forbidden psql meta-command {meta}")
            if _COPY_PROGRAM_RE.search(stripped):
                violations.append(f"line {lineno}: COPY ... PROGRAM is forbidden")
            # Every real pg_dumpall re-asserts the admin role's own SUPERUSER
            # attribute; that line is benign. Anything else persisting a
            # superuser is forbidden.
            superuser_match = _SUPERUSER_GRANT_RE.search(stripped)
            if superuser_match and superuser_match.group(2) != admin:
                violations.append(f"line {lineno}: SUPERUSER grants are forbidden")
            if len(violations) >= 20:
                break
    if violations:
        preview = "; ".join(violations[:5])
        raise ValueError(f"dump contains forbidden statements: {preview}")


class UploadStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._dir = settings.restore_dir

    def create(self, filename: str, size: int) -> str:
        if not filename.lower().endswith(ALLOWED_SUFFIXES):
            raise ValueError(f"filename must end with one of {ALLOWED_SUFFIXES}")
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
        hasher = hashlib.sha256()
        with part_path.open("rb") as part_file:
            while True:
                chunk = part_file.read(1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        if hasher.hexdigest() != sha256.lower():
            raise ValueError("sha256 mismatch")
        scan = validate_dump(part_path, filename=meta.filename, passphrase=self._passphrase())
        final_path = self._dir / f"{upload_id}{_stored_suffix(meta.filename)}"
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
        path = self._dir / f"{upload_id}{_stored_suffix(meta.filename)}"
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
                try:
                    _validate_upload_id(upload_id)
                except ValueError:
                    meta_path.unlink(missing_ok=True)
                    continue
                for path in self._artifact_paths(upload_id, meta.filename):
                    if path.exists():
                        path.unlink()
                meta_path.unlink()

    def _artifact_paths(self, upload_id: str, filename: str) -> list[Path]:
        paths = [self._part_path(upload_id)]
        try:
            paths.append(self._dir / f"{upload_id}{_stored_suffix(filename)}")
        except ValueError:
            pass
        return paths

    def _part_path(self, upload_id: str) -> Path:
        _validate_upload_id(upload_id)
        return self._dir / f"{upload_id}.part"

    def _meta_path(self, upload_id: str) -> Path:
        _validate_upload_id(upload_id)
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

    def _passphrase(self) -> str | None:
        return _dump_passphrase(self._settings)

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


def cluster_objects(psql: Psql) -> tuple[list[str], list[str]]:
    """Non-system databases and roles currently in the cluster.

    The admin role is excluded from the roles list: it pre-exists on every
    stack and a pg_dumpall restore always collides on it benignly.
    """
    admin = psql.admin_user()
    databases = [row[0] for row in psql.query_rows(_CLUSTER_DBS_SQL) if row]
    roles = [row[0] for row in psql.query_rows(_CLUSTER_ROLES_SQL) if row and row[0] != admin]
    return databases, roles


def cluster_is_empty(psql: Psql) -> bool:
    databases, roles = cluster_objects(psql)
    return not databases and not roles


def _drop_objects(psql: Psql, databases: list[str], roles: list[str]) -> None:
    statements = [f"DROP DATABASE IF EXISTS {quote_ident(name)};" for name in databases]
    statements.extend(f"DROP ROLE IF EXISTS {quote_ident(name)};" for name in roles)
    if not statements:
        return
    psql.exec_sql("\n".join(statements), database="postgres")


def _classify_load_errors(lines: list[str], admin: str) -> tuple[list[str], int]:
    """Split ERROR lines into (fatal, benign_count).

    A real pg_dumpall always contains `CREATE ROLE <admin>` and therefore
    always collides with the stack's admin role; that single collision is
    benign. pg_dump >= 17 also emits `SET transaction_timeout`, which older
    servers reject without affecting the rest of the load. Every other ERROR
    line means the dump did not apply as intended.
    """
    benign_re = re.compile(
        rf'ERROR:\s+role "{re.escape(admin)}" already exists'
        r'|ERROR:\s+unrecognized configuration parameter "transaction_timeout"'
    )
    fatal: list[str] = []
    benign = 0
    for line in lines:
        if benign_re.search(line):
            benign += 1
        else:
            fatal.append(line)
    return fatal, benign


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


def _dump_byte_chunks(path: Path, *, passphrase: str | None = None) -> Iterator[bytes]:
    with _open_dump_sql_stream(path, passphrase=passphrase, name=path.name) as stream:
        while True:
            chunk = stream.read(1024 * 1024)
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
    args = [
        "docker",
        "exec",
        settings.pg_container,
        "pg_dumpall",
        "-U",
        admin,
    ]
    # A real pg_dumpall takes minutes on a 5-app cluster; 120s aborted the
    # overwrite path mid-safety-dump (Task 19).
    runner.stream_to_gzip_file(args, path, 3600)
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
    overwrite: bool = False,
) -> dict:
    dump_path = UploadStore(settings).completed_path(upload_id)
    passphrase = _dump_passphrase(settings)
    _scan_for_dangerous_statements(
        dump_path, admin=psql.admin_user(), passphrase=passphrase, name=dump_path.name
    )
    databases, roles = cluster_objects(psql)
    empty = not databases and not roles
    if not empty and not overwrite:
        listing = ", ".join(databases + roles)
        raise ValueError(
            f"cluster is not empty (would be replaced: {listing}); "
            "re-run with overwrite=true to replace it"
        )
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
        if overwrite:
            ctx.log(f"dropping existing objects: {', '.join(databases + roles)}")
            _drop_objects(psql, databases, roles)

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
    error_lines: list[str] = []

    fatal_estimate = 0

    def on_line(line: str) -> None:
        nonlocal fatal_estimate
        ctx.log(line)
        if "ERROR:" in line:
            if len(error_lines) < 200:
                error_lines.append(line)
            else:
                fatal_estimate += 1

    returncode = 0
    try:
        returncode = runner.pipe_through(
            load_args, _dump_byte_chunks(dump_path, passphrase=passphrase), on_line, 120
        )
    finally:
        # A failed or interrupted load must not strand stopped project
        # containers or leave the admin password as the dump set it. The
        # restarts run even if the password reset itself fails.
        try:
            reset_admin_password(psql, settings)
        finally:
            for slug in stopped_slugs:
                project_dir = safe_project_path(settings.apps_dir, slug)
                args = ["docker", "compose", "-p", slug, "start"]
                ctx.log(f"compose start: {slug}")
                runner(args, cwd=project_dir, check=True)

    fatal, benign = _classify_load_errors(error_lines, admin)
    if returncode != 0:
        raise ValueError(f"restore failed: psql exited with code {returncode}")
    if fatal or fatal_estimate:
        # fatal_estimate counts ERROR lines beyond the 200-line capture cap so
        # 200 benign lines cannot mask later fatal ones.
        total = len(fatal) + fatal_estimate
        preview = "; ".join(fatal[:5]) or "(errors beyond capture cap)"
        raise ValueError(f"restore failed: {total} error(s) during load: {preview}")

    databases_out = list_databases(psql, db)
    roles_out = list_roles(psql)
    return {
        "databases": [d.model_dump() for d in databases_out],
        "roles": roles_out,
        "error_count": 0,
        "errors": [],
        "benign_errors": benign,
        "safety_dump": str(safety_dump) if safety_dump is not None else None,
    }
