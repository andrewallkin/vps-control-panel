from __future__ import annotations

import os
from pathlib import Path

from vpscp_agent.config import Settings

_INI_KEY = "dns_cloudflare_api_token"


def cloudflare_ini_path(settings: Settings) -> Path:
    return settings.state_dir / "cloudflare.ini"


def write_cloudflare_ini(settings: Settings, token: str) -> None:
    path = cloudflare_ini_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = f"{_INI_KEY} = {token}\n"
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    os.replace(tmp_path, path)
    os.chmod(path, 0o600)


def read_cloudflare_token(settings: Settings) -> str | None:
    path = cloudflare_ini_path(settings)
    if not path.is_file():
        return None
    for line in path.read_text().splitlines():
        if line.startswith(f"{_INI_KEY} = "):
            return line[len(f"{_INI_KEY} = ") :]
    return None
