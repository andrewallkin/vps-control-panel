import json
import re
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from vpscp_agent.state import StateDB

MASK = "***"
_SECRET_NAME = re.compile(
    r"\bpassword\b|token|secret|credential|passphrase|private_key|api_key|apikey|"
    r"credentials|secret_key|service_account",
    re.IGNORECASE,
)
_KV_SECRET = re.compile(
    r"(?i)((?:password|token|secret|api_key|apikey|credentials|private_key|secret_key)\s*[=:])\s*\S+"
)
_POSTGRES_URL = re.compile(r"(postgresql://[^:]+:)([^@]+)(@)")


def scrub_error_message(message: str) -> str:
    scrubbed = _POSTGRES_URL.sub(r"\1***\3", message)
    return _KV_SECRET.sub(r"\1***", scrubbed)


class AuditEvent(BaseModel):
    id: int
    ts: str
    operation: str
    params: dict[str, Any]
    ok: bool
    error: str | None
    duration_ms: int


def mask_secrets(value: Any, extra: frozenset[str] = frozenset()) -> Any:
    if isinstance(value, dict):
        return {
            key: MASK if (_SECRET_NAME.search(key) or key in extra) else mask_secrets(item, extra)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [mask_secrets(item, extra) for item in value]
    return value


def record(
    db: StateDB,
    operation: str,
    params: dict[str, Any],
    *,
    ok: bool,
    error: str | None,
    duration_ms: int,
    extra_secret_fields: frozenset[str] = frozenset(),
) -> int:
    masked = mask_secrets(params, extra_secret_fields)
    with db.connect() as conn:
        cursor = conn.execute(
            "INSERT INTO audit_event (ts, operation, params_json, ok, error, duration_ms) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                datetime.now(UTC).isoformat(timespec="seconds"),
                operation,
                json.dumps(masked, default=str),
                int(ok),
                error,
                duration_ms,
            ),
        )
        return int(cursor.lastrowid)


@contextmanager
def audited(
    db: StateDB,
    operation: str,
    params: dict[str, Any],
    extra_secret_fields: frozenset[str] = frozenset(),
) -> Iterator[None]:
    start = time.monotonic()
    try:
        yield
    except Exception as exc:
        record(
            db,
            operation,
            params,
            ok=False,
            error=f"{type(exc).__name__}: {scrub_error_message(str(exc))}",
            duration_ms=int((time.monotonic() - start) * 1000),
            extra_secret_fields=extra_secret_fields,
        )
        raise
    record(
        db,
        operation,
        params,
        ok=True,
        error=None,
        duration_ms=int((time.monotonic() - start) * 1000),
        extra_secret_fields=extra_secret_fields,
    )


def list_events(db: StateDB, limit: int = 100, before_id: int | None = None) -> list[AuditEvent]:
    query = "SELECT * FROM audit_event"
    args: list[Any] = []
    if before_id is not None:
        query += " WHERE id < ?"
        args.append(before_id)
    query += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with db.connect() as conn:
        rows = conn.execute(query, args).fetchall()
    return [
        AuditEvent(
            id=row["id"],
            ts=row["ts"],
            operation=row["operation"],
            params=json.loads(row["params_json"]),
            ok=bool(row["ok"]),
            error=row["error"],
            duration_ms=row["duration_ms"],
        )
        for row in rows
    ]
