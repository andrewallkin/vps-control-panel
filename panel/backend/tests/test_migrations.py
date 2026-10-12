from sqlalchemy import inspect

from vpscp_panel.db import get_engine


def test_migration_creates_core_tables(client):
    inspector = inspect(get_engine())
    table_names = set(inspector.get_table_names())

    assert {
        "admin_user",
        "session",
        "setting",
        "domain",
        "project",
        "project_service",
        "project_hostname",
        "project_route",
        "port_allocation",
        "deploy",
        "panel_event",
    }.issubset(table_names)


def test_run_migrations_twice_is_safe(panel_settings):
    """install.sh's CLI (has-admin) and the server lifespan both run
    migrations at first boot; two sequential runs must be safe, and a
    concurrent second run must not crash the installer with
    'database is locked' / 'table already exists'."""
    from vpscp_panel.db import init_db, run_migrations

    run_migrations(panel_settings)
    init_db(panel_settings)
    run_migrations(panel_settings)  # second run: no-op, must not raise


def test_concurrent_run_migrations_does_not_raise(panel_settings):
    """install.sh runs the CLI (has-admin → run_migrations) while the panel
    server lifespan is already migrating the same fresh SQLite file. The
    loser of that race must not raise 'database is locked' or
    'table already exists' — that aborts install mid-setup."""
    import threading

    from vpscp_panel.db import run_migrations

    errors: list[Exception] = []

    def migrate() -> None:
        try:
            run_migrations(panel_settings)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=migrate) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
