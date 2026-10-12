import json
import re
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.models import PanelEvent

MASK = "***"
_SECRET_NAME = re.compile(
    r"\bpassword\b|token|secret|credential|passphrase|private_key|api_key|apikey|"
    r"credentials|secret_key|service_account",
    re.IGNORECASE,
)


def mask_secrets(value: Any, extra: frozenset[str] = frozenset()) -> Any:
    if isinstance(value, dict):
        return {
            key: MASK if (_SECRET_NAME.search(key) or key in extra) else mask_secrets(item, extra)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [mask_secrets(item, extra) for item in value]
    return value


def record_panel_event(
    db: DbSession,
    operation: str,
    params: dict[str, Any],
    *,
    ok: bool,
    duration_ms: int,
    ts: datetime | None = None,
    extra_secret_fields: frozenset[str] = frozenset(),
) -> PanelEvent:
    masked = mask_secrets(params, extra_secret_fields)
    row = PanelEvent(
        ts=ts if ts is not None else datetime.now(UTC),
        operation=operation,
        params_json=json.dumps(masked),
        ok=ok,
        duration_ms=duration_ms,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@contextmanager
def panel_audited(
    db: DbSession,
    operation: str,
    params: dict[str, Any],
    *,
    extra_secret_fields: frozenset[str] = frozenset(),
):
    start = time.monotonic()
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        duration_ms = int((time.monotonic() - start) * 1000)
        record_panel_event(
            db,
            operation,
            params,
            ok=ok,
            duration_ms=duration_ms,
            extra_secret_fields=extra_secret_fields,
        )


def list_panel_events(
    db: DbSession,
    *,
    operation: str | None = None,
    ok: bool | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[PanelEvent]:
    query = select(PanelEvent).order_by(PanelEvent.ts.desc(), PanelEvent.id.desc())
    if operation is not None:
        query = query.where(PanelEvent.operation == operation)
    if ok is not None:
        query = query.where(PanelEvent.ok == ok)
    if since is not None:
        query = query.where(PanelEvent.ts >= since)
    if until is not None:
        query = query.where(PanelEvent.ts <= until)
    return list(db.scalars(query).all())
