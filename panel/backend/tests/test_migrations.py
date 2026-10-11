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
    }.issubset(table_names)
