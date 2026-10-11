from __future__ import annotations

import os

import pytest

from vpscp_agent.commands import run_command
from vpscp_agent.config import Settings, load_settings
from vpscp_agent.pg import Psql, quote_ident
from vpscp_agent.state import StateDB

pytestmark = pytest.mark.integration


@pytest.fixture(scope="session")
def pg_container() -> str:
    name = os.environ.get("VPSCP_IT_PG_CONTAINER")
    if not name:
        pytest.skip("VPSCP_IT_PG_CONTAINER not set")
    return name


@pytest.fixture(scope="session")
def pg_password() -> str:
    password = os.environ.get("VPSCP_IT_PG_PASSWORD")
    if not password:
        pytest.skip("VPSCP_IT_PG_PASSWORD not set")
    return password


@pytest.fixture
def it_env(
    tmp_path,
    pg_container: str,
    pg_password: str,
) -> tuple[Settings, Psql, StateDB, str]:
    stack_dir = tmp_path / "stack"
    stack_dir.mkdir()
    stack_env = stack_dir / ".env"
    stack_env.write_text(f"POSTGRES_USER=pgadmin\nPOSTGRES_PASSWORD={pg_password}\n")

    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(stack_dir),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
            "VPSCP_PG_CONTAINER": pg_container,
        }
    )
    settings.apps_dir.mkdir(parents=True, exist_ok=True)
    state = StateDB(settings.state_db_path)
    state.migrate()
    psql = Psql(settings, run_command)
    return settings, psql, state, pg_password


def drop_db_and_role(psql: Psql, *, db_name: str, db_user: str) -> None:
    db_q = quote_ident(db_name)
    user_q = quote_ident(db_user)
    psql.exec_sql(
        f"DROP DATABASE IF EXISTS {db_q};\nDROP ROLE IF EXISTS {user_q};\n",
        database="postgres",
        on_error_stop=False,
    )


def clear_attachment(state: StateDB, db_name: str) -> None:
    with state.connect() as conn:
        conn.execute("DELETE FROM db_attachment WHERE db_name = ?", (db_name,))
