import json
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from vpscp_agent import audit
from vpscp_agent.audit import mask_secrets, scrub_error_message
from vpscp_agent.state import StateDB

JobStatus = Literal["running", "succeeded", "failed"]


class JobLockedError(Exception):
    pass


@dataclass
class Job:
    kind: str
    params: dict[str, Any]
    status: JobStatus = "running"
    started_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat(timespec="seconds"))
    finished_at: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    lines: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    _lines_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _persist_hook: Any = field(default=None, repr=False)

    def log(self, line: str) -> None:
        text = scrub_error_message(line.rstrip("\n"))
        with self._lines_lock:
            self.lines.append(text)
            count = len(self.lines)
        if count % 20 == 0:
            persist = getattr(self, "_persist_hook", None)
            if persist is not None:
                persist(self)

    def snapshot(self, since: int = 0) -> dict[str, Any]:
        with self._lines_lock:
            lines = list(self.lines[since:])
        return {
            "id": self.id,
            "kind": self.kind,
            "params": self.params,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": self.result,
            "error": self.error,
            "lines": lines,
        }


class JobContext:
    def __init__(self, job: Job) -> None:
        self._job = job

    @property
    def job_id(self) -> str:
        return self._job.id

    def log(self, line: str) -> None:
        self._job.log(line)


class JobManager:
    def __init__(self, db: StateDB, keep: int = 50) -> None:
        self._db = db
        self._keep = keep
        self._jobs: dict[str, Job] = {}
        self._lock_keys: dict[str, str] = {}
        self._lock = threading.Lock()
        self._recover_persisted()

    def _persist(self, job: Job) -> None:
        with self._db.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO job "
                "(id, kind, params_json, status, result_json, error, started_at, finished_at, log) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    job.id,
                    job.kind,
                    json.dumps(job.params),
                    job.status,
                    json.dumps(job.result) if job.result is not None else None,
                    job.error,
                    job.started_at,
                    job.finished_at,
                    "\n".join(job.lines),
                ),
            )

    def _recover_persisted(self) -> None:
        """Reload job records from state.db so a restart does not strand
        consumers (the setup wizard tracks restore jobs across refreshes).
        A row still marked 'running' belonged to a dead process: finalize it
        as failed rather than leaving it running forever."""
        try:
            with self._db.connect() as conn:
                rows = conn.execute("SELECT * FROM job ORDER BY started_at").fetchall()
        except sqlite3.OperationalError:
            # JobManager is built in create_app before migrate() runs; there is
            # nothing to recover on a fresh database anyway.
            return
        for row in rows:
            job = Job(
                id=row["id"],
                kind=row["kind"],
                params=json.loads(row["params_json"]),
                status=row["status"],
                started_at=row["started_at"],
                finished_at=row["finished_at"],
                result=json.loads(row["result_json"]) if row["result_json"] else None,
                error=row["error"],
            )
            for line in (row["log"] or "").splitlines():
                job.lines.append(line)
            if job.status == "running":
                job.status = "failed"
                job.error = "interrupted: agent restarted while running"
                job.finished_at = datetime.now(UTC).isoformat(timespec="seconds")
                self._persist(job)
            self._jobs[job.id] = job

    def start(
        self,
        kind: str,
        params: dict[str, Any],
        body: Callable[[JobContext], dict[str, Any] | None],
        lock_key: str | None = None,
        extra_secret_fields: frozenset[str] = frozenset(),
    ) -> Job:
        masked_params = mask_secrets(params, extra_secret_fields)
        job = Job(kind=kind, params=masked_params)
        with self._lock:
            if lock_key is not None:
                holder = self._lock_keys.get(lock_key)
                if holder is not None:
                    existing = self._jobs.get(holder)
                    if existing is not None and existing.status == "running":
                        raise JobLockedError(lock_key)
            self._jobs[job.id] = job
            if lock_key is not None:
                self._lock_keys[lock_key] = job.id
        job._persist_hook = self._persist
        self._persist(job)

        def run() -> None:
            start = time.monotonic()
            ctx = JobContext(job)
            ok = False
            result: dict[str, Any] | None = None
            error: str | None = None
            try:
                result = body(ctx)
                ok = True
            except Exception as exc:  # noqa: BLE001
                error = f"{type(exc).__name__}: {scrub_error_message(str(exc))}"
            finally:
                job.finished_at = datetime.now(UTC).isoformat(timespec="seconds")
                duration_ms = int((time.monotonic() - start) * 1000)
                audit.record(
                    self._db,
                    kind,
                    params,
                    ok=ok,
                    error=error,
                    duration_ms=duration_ms,
                    extra_secret_fields=extra_secret_fields,
                )
                job.status = "succeeded" if ok else "failed"
                job.result = result
                job.error = error
                self._persist(job)
                with self._lock:
                    if lock_key is not None and self._lock_keys.get(lock_key) == job.id:
                        del self._lock_keys[lock_key]
                    self._trim_finished()

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return job

    def _trim_finished(self) -> None:
        finished = [
            job_id for job_id, job in self._jobs.items() if job.status in ("succeeded", "failed")
        ]
        if len(finished) <= self._keep:
            return
        finished.sort(key=lambda jid: self._jobs[jid].finished_at or "")
        for job_id in finished[: len(finished) - self._keep]:
            del self._jobs[job_id]

    def has_lock_prefix(self, prefix: str) -> bool:
        with self._lock:
            for key, job_id in self._lock_keys.items():
                if not key.startswith(prefix):
                    continue
                job = self._jobs.get(job_id)
                if job is not None and job.status == "running":
                    return True
        return False

    def is_locked(self, key: str) -> bool:
        with self._lock:
            holder = self._lock_keys.get(key)
            if holder is None:
                return False
            job = self._jobs.get(holder)
            return job is not None and job.status == "running"

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is not None:
            return job
        with self._db.connect() as conn:
            row = conn.execute("SELECT * FROM job WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        recovered = Job(
            id=row["id"],
            kind=row["kind"],
            params=json.loads(row["params_json"]),
            status=row["status"] if row["status"] != "running" else "failed",
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            result=json.loads(row["result_json"]) if row["result_json"] else None,
            error=row["error"],
        )
        return recovered

    def list(self) -> list[Job]:
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(key=lambda j: j.started_at, reverse=True)
        return jobs

    def wait(self, job_id: str, timeout: float) -> Job:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.status != "running":
                return job
            time.sleep(0.01)
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job
