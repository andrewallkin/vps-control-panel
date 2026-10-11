from __future__ import annotations

import csv
import io
import re
import secrets
import string
from collections.abc import Mapping
from typing import TYPE_CHECKING

from vpscp_agent.envfile import read_env
from vpscp_agent.validation import validate_sql_ident

if TYPE_CHECKING:
    from vpscp_agent.commands import Runner
    from vpscp_agent.config import Settings

_SECRET_ENV_RE = re.compile(r"^VPSCP_[A-Z0-9_]+$")


def generate_password(length: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def quote_ident(name: str) -> str:
    validate_sql_ident(name)
    return f'"{name}"'


def _validate_secret_names(secrets: Mapping[str, str] | None) -> None:
    if secrets is None:
        return
    for key in secrets:
        if key != "PGPASSWORD" and not _SECRET_ENV_RE.fullmatch(key):
            raise ValueError(f"invalid secret env var name: {key!r}")


class Psql:
    def __init__(self, settings: Settings, runner: Runner) -> None:
        self._settings = settings
        self._runner = runner

    def admin_user(self) -> str:
        env = read_env(self._settings.stack_env_path)
        user = env.get("POSTGRES_USER") or "pgadmin"
        return validate_sql_ident(user)

    def _base_args(
        self,
        *,
        database: str,
        secrets: Mapping[str, str] | None,
        on_error_stop: bool,
        extra_psql_flags: list[str] | None = None,
    ) -> list[str]:
        _validate_secret_names(secrets)
        admin = self.admin_user()
        args = ["docker", "exec", "-i"]
        if secrets:
            for name in secrets:
                args.extend(["-e", name])
        args.append(self._settings.pg_container)
        args.extend(["psql", "-X", "-q"])
        if extra_psql_flags:
            args.extend(extra_psql_flags)
        stop = "1" if on_error_stop else "0"
        args.extend(["-v", f"ON_ERROR_STOP={stop}", "-U", admin, "-d", database, "-f", "-"])
        return args

    def exec_sql(
        self,
        sql: str,
        *,
        database: str = "postgres",
        secrets: Mapping[str, str] | None = None,
        on_error_stop: bool = True,
        timeout: float = 120,
    ) -> str:
        args = self._base_args(
            database=database,
            secrets=secrets,
            on_error_stop=on_error_stop,
        )
        result = self._runner(
            args,
            input_data=sql,
            extra_env=dict(secrets) if secrets else None,
            timeout=timeout,
            check=True,
        )
        return result.stdout

    def query_rows(
        self,
        sql: str,
        *,
        database: str = "postgres",
    ) -> list[list[str]]:
        args = self._base_args(
            database=database,
            secrets=None,
            on_error_stop=True,
            extra_psql_flags=["--csv", "--tuples-only"],
        )
        result = self._runner(
            args,
            input_data=sql,
            timeout=120,
            check=True,
        )
        reader = csv.reader(io.StringIO(result.stdout))
        return list(reader)

    def verify_login(self, user: str, password: str, database: str) -> bool:
        validate_sql_ident(user)
        container = self._settings.pg_container
        secrets = {"PGPASSWORD": password}
        _validate_secret_names(secrets)
        args = [
            "docker",
            "exec",
            "-e",
            "PGPASSWORD",
            container,
            "psql",
            "-X",
            "-h",
            container,
            "-U",
            user,
            "-d",
            database,
            "-tAc",
            "SELECT 1",
        ]
        result = self._runner(
            args,
            extra_env=secrets,
            check=False,
        )
        return result.returncode == 0 and result.stdout.strip() == "1"
