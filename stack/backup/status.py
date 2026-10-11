import json
import os
from pathlib import Path

STATE_DIR = Path(os.environ.get("BACKUP_STATE_DIR", "/state"))
STATUS_FILENAME = "last_run.json"

_STATUS_KEYS = (
    "started_at",
    "finished_at",
    "success",
    "object",
    "size_bytes",
    "archive_object",
    "archive_skipped_reason",
    "archive_error",
    "error",
)


def write_status(**fields) -> None:
    """Write last_run.json atomically under STATE_DIR."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    path = STATE_DIR / STATUS_FILENAME
    payload = {key: fields.get(key) for key in _STATUS_KEYS if key in fields}
    tmp_path = path.with_name(f".{STATUS_FILENAME}.tmp")
    tmp_path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    os.replace(tmp_path, path)


def consume_trigger() -> bool:
    trigger = STATE_DIR / "run-now"
    if trigger.exists():
        trigger.unlink()
        return True
    return False
