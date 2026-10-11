import stat

from vpscp_agent.state import MIGRATIONS, StateDB


def _tables(db: StateDB) -> set[str]:
    with db.connect() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {row["name"] for row in rows}


def test_migrate_creates_tables(tmp_path):
    db = StateDB(tmp_path / "state" / "state.db")

    version = db.migrate()

    assert version == len(MIGRATIONS)
    assert {"schema_version", "audit_event", "metric_sample", "db_attachment"} <= _tables(db)


def test_migration_creates_db_attachment(tmp_path):
    db = StateDB(tmp_path / "state.db")
    db.migrate()

    with db.connect() as conn:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'db_attachment'"
        ).fetchone()
    assert row is not None
    assert "db_name TEXT PRIMARY KEY" in row["sql"]
    assert "slug TEXT NOT NULL UNIQUE" in row["sql"]


def test_migrate_is_idempotent(tmp_path):
    db = StateDB(tmp_path / "state.db")

    db.migrate()
    db.migrate()

    with db.connect() as conn:
        rows = conn.execute("SELECT version FROM schema_version").fetchall()
    assert [row["version"] for row in rows] == [len(MIGRATIONS)]


def test_state_dir_is_private(tmp_path):
    db = StateDB(tmp_path / "state" / "state.db")

    db.migrate()

    mode = stat.S_IMODE((tmp_path / "state").stat().st_mode)
    assert mode == 0o700


def test_connect_returns_rows_by_name(tmp_path):
    db = StateDB(tmp_path / "state.db")
    db.migrate()

    with db.connect() as conn:
        row = conn.execute("SELECT 1 AS one").fetchone()

    assert row["one"] == 1
