import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS: list[str] = [
    """
    CREATE TABLE audit_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        operation TEXT NOT NULL,
        params_json TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        duration_ms INTEGER NOT NULL
    );
    CREATE INDEX ix_audit_event_ts ON audit_event (ts);
    CREATE TABLE metric_sample (
        ts TEXT PRIMARY KEY,
        cpu_percent REAL NOT NULL,
        load1 REAL NOT NULL,
        load5 REAL NOT NULL,
        load15 REAL NOT NULL,
        mem_total INTEGER NOT NULL,
        mem_available INTEGER NOT NULL,
        swap_total INTEGER NOT NULL,
        swap_used INTEGER NOT NULL,
        disks_json TEXT NOT NULL
    );
    """,
]


class StateDB:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def migrate(self) -> int:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path.parent.chmod(0o700)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
            row = conn.execute("SELECT version FROM schema_version").fetchone()
            if row is None:
                conn.execute("INSERT INTO schema_version (version) VALUES (0)")
                current = 0
            else:
                current = row["version"]
            for version, sql in enumerate(MIGRATIONS[current:], start=current + 1):
                conn.executescript(
                    f"BEGIN; {sql} UPDATE schema_version SET version = {version}; COMMIT;"
                )
        return len(MIGRATIONS)
