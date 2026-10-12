import base64
import json
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session as DbSession

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, get_db
from vpscp_panel.models import PanelEvent, Session
from vpscp_panel.panel_events import list_panel_events

router = APIRouter(tags=["audit"])

_MAX_AGENT_PAGES = 5
_AGENT_PAGE_LIMIT = 500


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


def _parse_iso_dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _encode_cursor(source: str, row_id: int, ts: datetime) -> str:
    payload = {"source": source, "id": row_id, "ts": ts.astimezone(UTC).isoformat()}
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()


def _decode_cursor(value: str) -> tuple[str, int, datetime]:
    try:
        raw = base64.urlsafe_b64decode(value.encode())
        data = json.loads(raw)
        source = data["source"]
        row_id = int(data["id"])
        ts = _parse_iso_dt(data["ts"])
        assert ts is not None
        if source not in ("agent", "panel"):
            raise ValueError("bad source")
        return source, row_id, ts
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="invalid cursor") from exc


def _row_key(source: str, row_id: int, ts: datetime) -> tuple[datetime, str, int]:
    return (ts.astimezone(UTC), source, row_id)


def _is_older_than(
    source: str,
    row_id: int,
    ts: datetime,
    cursor_source: str,
    cursor_id: int,
    cursor_ts: datetime,
) -> bool:
    key = _row_key(source, row_id, ts)
    cursor_key = _row_key(cursor_source, cursor_id, cursor_ts)
    return key < cursor_key


def _agent_entry(event: dict[str, Any]) -> dict[str, Any] | None:
    ts_raw = event.get("ts")
    operation = event.get("operation")
    if not isinstance(ts_raw, str) or not isinstance(operation, str):
        return None
    ts = _parse_iso_dt(ts_raw)
    if ts is None:
        return None
    params = event.get("params")
    if not isinstance(params, dict):
        params = {}
    return {
        "time": ts.isoformat(),
        "source": "agent",
        "operation": operation,
        "params": params,
        "ok": bool(event.get("ok")),
        "duration_ms": int(event.get("duration_ms") or 0),
        "_sort_id": int(event.get("id") or 0),
        "_sort_ts": ts,
    }


def _panel_entry(row: PanelEvent) -> dict[str, Any]:
    ts = row.ts if row.ts.tzinfo else row.ts.replace(tzinfo=UTC)
    params = json.loads(row.params_json)
    return {
        "time": ts.isoformat(),
        "source": "panel",
        "operation": row.operation,
        "params": params,
        "ok": row.ok,
        "duration_ms": row.duration_ms,
        "_sort_id": row.id,
        "_sort_ts": ts.astimezone(UTC),
    }


async def _fetch_agent_entries(
    agent: AgentClient,
    *,
    since: datetime | None,
    operation: str | None,
    ok: bool | None,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    before_id: int | None = None
    for _ in range(_MAX_AGENT_PAGES):
        params: dict[str, str] = {"limit": str(_AGENT_PAGE_LIMIT)}
        if before_id is not None:
            params["before_id"] = str(before_id)
        page = await agent.get("/v1/audit", params=params)
        if not isinstance(page, list):
            break
        if not page:
            break
        oldest_ts: datetime | None = None
        for raw in page:
            entry = _agent_entry(raw)
            if entry is None:
                continue
            if operation is not None and entry["operation"] != operation:
                continue
            if ok is not None and entry["ok"] != ok:
                continue
            if since is not None and entry["_sort_ts"] < since:
                continue
            collected.append(entry)
            ts = entry["_sort_ts"]
            if oldest_ts is None or ts < oldest_ts:
                oldest_ts = ts
        last_id = page[-1].get("id") if isinstance(page[-1], dict) else None
        if not isinstance(last_id, int):
            break
        before_id = last_id
        if since is not None and oldest_ts is not None and oldest_ts < since:
            break
    return collected


@router.get("/api/audit")
async def audit_feed(
    db: Annotated[DbSession, Depends(get_db)],
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = None,
    operation: str | None = None,
    ok: bool | None = None,
    since: str | None = None,
    until: str | None = None,
) -> dict[str, Any]:
    since_dt = _parse_iso_dt(since)
    until_dt = _parse_iso_dt(until)
    cursor_source: str | None = None
    cursor_id: int | None = None
    cursor_ts: datetime | None = None
    if cursor is not None:
        cursor_source, cursor_id, cursor_ts = _decode_cursor(cursor)

    panel_rows = list_panel_events(
        db,
        operation=operation,
        ok=ok,
        since=since_dt,
        until=until_dt,
    )
    panel_entries = [_panel_entry(row) for row in panel_rows]
    agent_entries = await _fetch_agent_entries(
        agent,
        since=since_dt,
        operation=operation,
        ok=ok,
    )

    merged = panel_entries + agent_entries
    if cursor_source is not None and cursor_id is not None and cursor_ts is not None:
        merged = [
            row
            for row in merged
            if _is_older_than(
                row["source"],
                row["_sort_id"],
                row["_sort_ts"],
                cursor_source,
                cursor_id,
                cursor_ts,
            )
        ]
    if until_dt is not None:
        merged = [row for row in merged if row["_sort_ts"] <= until_dt]

    merged.sort(key=lambda row: (row["_sort_ts"], row["source"], row["_sort_id"]), reverse=True)

    page = merged[: limit + 1]
    has_more = len(page) > limit
    if has_more:
        page = page[:limit]
    entries = [
        {
            "time": row["time"],
            "source": row["source"],
            "operation": row["operation"],
            "params": row["params"],
            "ok": row["ok"],
            "duration_ms": row["duration_ms"],
        }
        for row in page
    ]
    next_cursor: str | None = None
    if has_more and page:
        last = page[-1]
        next_cursor = _encode_cursor(last["source"], last["_sort_id"], last["_sort_ts"])
    return {"entries": entries, "next_cursor": next_cursor}
