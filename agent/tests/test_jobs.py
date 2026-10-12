import threading

import pytest

from vpscp_agent import audit
from vpscp_agent.jobs import JobLockedError, JobManager


def test_job_runs_and_audits(settings):
    from vpscp_agent.state import StateDB

    db = StateDB(settings.state_db_path)
    db.migrate()
    mgr = JobManager(db)
    job = mgr.start("demo.run", {"password": "x"}, lambda ctx: (ctx.log("hello"), {"n": 1})[1])
    done = mgr.wait(job.id, timeout=5)
    assert done.status == "succeeded" and done.result == {"n": 1} and done.lines == ["hello"]
    event = audit.list_events(db)[0]
    assert event.operation == "demo.run" and event.params == {"password": "***"} and event.ok


def test_job_failure_recorded(settings):
    from vpscp_agent.state import StateDB

    db = StateDB(settings.state_db_path)
    db.migrate()
    mgr = JobManager(db)

    def boom(_ctx):
        raise RuntimeError("boom")

    job = mgr.start("demo.fail", {}, boom)
    done = mgr.wait(job.id, timeout=5)
    assert done.status == "failed"
    assert done.error is not None and "boom" in done.error
    event = audit.list_events(db)[0]
    assert event.operation == "demo.fail" and not event.ok
    assert event.error is not None and "boom" in event.error


def test_lock_key_conflict(settings):
    from vpscp_agent.state import StateDB

    db = StateDB(settings.state_db_path)
    db.migrate()
    mgr = JobManager(db)
    gate = threading.Event()

    def block(_ctx):
        gate.wait(timeout=10)

    first = mgr.start("demo.block", {}, block, lock_key="same")
    try:
        with pytest.raises(JobLockedError):
            mgr.start("demo.block", {}, lambda _ctx: None, lock_key="same")
    finally:
        gate.set()
    mgr.wait(first.id, timeout=5)
    second = mgr.start("demo.block", {}, lambda _ctx: None, lock_key="same")
    done = mgr.wait(second.id, timeout=5)
    assert done.status == "succeeded"


def test_job_log_persisted_before_completion(settings):
    """An agent crash mid-restore must leave a log tail behind: lines are
    flushed to state.db periodically, not only at job end."""
    import threading
    import time as _time

    from vpscp_agent.state import StateDB

    db = StateDB(settings.state_db_path)
    db.migrate()
    mgr = JobManager(db)
    gate = threading.Event()

    def long_job(ctx):
        for index in range(25):
            ctx.log(f"line {index}")
        gate.wait(timeout=10)
        return {"done": True}

    job = mgr.start("demo", {}, long_job)
    deadline = _time.monotonic() + 5
    row = None
    while _time.monotonic() < deadline:
        with db.connect() as conn:
            row = conn.execute("SELECT log FROM job WHERE id = ?", (job.id,)).fetchone()
        if row is not None and "line 19" in (row["log"] or ""):
            break
        _time.sleep(0.05)
    gate.set()
    mgr.wait(job.id, timeout=5)

    assert row is not None
    # flushed at the 20-line mark while the job was still running
    assert "line 19" in row["log"], "log tail must be persisted before the job finishes"


def test_sse_replays_and_ends(client):
    mgr = client.app.state.jobs
    job = mgr.start("demo", {}, lambda ctx: (ctx.log("a"), ctx.log("b"), None)[2])
    mgr.wait(job.id, 5)
    with client.stream("GET", f"/v1/jobs/{job.id}/events") as resp:
        body = "".join(resp.iter_text())
    assert body.index('"text": "a"') < body.index('"text": "b"') < body.index("event: end")


def test_unknown_job_404(client):
    assert client.get("/v1/jobs/nope").status_code == 404
