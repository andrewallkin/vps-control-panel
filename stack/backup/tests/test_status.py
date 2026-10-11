import json
import os
from pathlib import Path

import pytest

import status


@pytest.fixture
def state_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_STATE_DIR", str(tmp_path))
    # Re-read STATE_DIR after env change
    monkeypatch.setattr(status, "STATE_DIR", Path(str(tmp_path)))
    return tmp_path


def test_write_status_creates_last_run_json(state_dir):
    status.write_status(
        started_at="2026-01-01T00:00:00Z",
        finished_at="2026-01-01T00:01:00Z",
        success=True,
        object="backup_2026-01-01.sql.gz",
        size_bytes=1234,
        archive_object=None,
        archive_skipped_reason="no passphrase configured",
        error=None,
    )
    path = state_dir / "last_run.json"
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["success"] is True
    assert data["object"] == "backup_2026-01-01.sql.gz"
    assert data["archive_skipped_reason"] == "no passphrase configured"


def test_write_status_is_atomic(state_dir, monkeypatch):
    written = []

    original_replace = os.replace

    def tracking_replace(src, dst):
        written.append(Path(src).read_text())
        return original_replace(src, dst)

    monkeypatch.setattr(os, "replace", tracking_replace)
    status.write_status(started_at="t0", finished_at="t1", success=False, error="fail")
    assert len(written) == 1
    assert json.loads(written[0])["error"] == "fail"


def test_consume_trigger_when_absent(state_dir):
    assert status.consume_trigger() is False


def test_consume_trigger_when_present(state_dir):
    trigger = state_dir / "run-now"
    trigger.write_text("")
    assert status.consume_trigger() is True
    assert not trigger.exists()


def test_consume_trigger_second_call_false(state_dir):
    (state_dir / "run-now").write_text("")
    assert status.consume_trigger() is True
    assert status.consume_trigger() is False
