from urllib.parse import quote

MANAGED_ENV_KEYS = frozenset(
    {
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "DATABASE_URL",
    }
)


def _parse_env_keys(user_env: str | None) -> set[str]:
    keys: set[str] = set()
    if not user_env:
        return keys
    for line in user_env.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _ = stripped.split("=", 1)
        keys.add(key)
    return keys


def build_project_env_content(
    *,
    user_env: str | None,
    database_mode: str,
    db_name: str | None,
    db_user: str | None,
    db_password: str | None,
    write_database_url: bool,
    ports: dict[str, int],
) -> str:
    port_keys = set(ports.keys())
    skip_keys = MANAGED_ENV_KEYS | port_keys

    lines: list[str] = []
    if user_env:
        for line in user_env.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                lines.append(line)
                continue
            key, _ = stripped.split("=", 1)
            if key in skip_keys:
                continue
            lines.append(line)

    for env_var, port in sorted(ports.items()):
        lines.append(f"{env_var}={port}")

    if database_mode != "none" and db_name and db_user and db_password is not None:
        lines.extend(
            [
                "POSTGRES_HOST=postgres-central",
                "POSTGRES_PORT=5432",
                f"POSTGRES_DB={db_name}",
                f"POSTGRES_USER={db_user}",
                f"POSTGRES_PASSWORD={db_password}",
            ]
        )
        if write_database_url:
            encoded = quote(db_password, safe="")
            lines.append(
                f"DATABASE_URL=postgresql://{db_user}:{encoded}@postgres-central:5432/{db_name}"
            )

    return "\n".join(lines) + ("\n" if lines else "")


def patch_env_password_lines(
    content: str,
    *,
    db_user: str,
    db_password: str,
    db_name: str,
    write_database_url: bool,
) -> str:
    encoded = quote(db_password, safe="")
    database_url = f"postgresql://{db_user}:{encoded}@postgres-central:5432/{db_name}"
    out: list[str] = []
    seen_pg = False
    seen_url = False
    for line in content.splitlines():
        if line.startswith("POSTGRES_PASSWORD="):
            out.append(f"POSTGRES_PASSWORD={db_password}")
            seen_pg = True
            continue
        if line.startswith("DATABASE_URL="):
            if write_database_url:
                out.append(f"DATABASE_URL={database_url}")
            seen_url = True
            continue
        out.append(line)
    if not seen_pg:
        out.append(f"POSTGRES_PASSWORD={db_password}")
    if write_database_url and not seen_url:
        out.append(f"DATABASE_URL={database_url}")
    return "\n".join(out) + ("\n" if out else "")
