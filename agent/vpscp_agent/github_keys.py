from __future__ import annotations

import os
import shlex
from collections.abc import Callable
from pathlib import Path

import httpx

from vpscp_agent.config import Settings


def known_hosts_path(settings: Settings) -> Path:
    return settings.state_dir / "known_hosts"


def git_ssh_command(key_path: Path | str, known_hosts: Path | str) -> str:
    key_q = shlex.quote(str(key_path))
    hosts_q = shlex.quote(str(known_hosts))
    return (
        f"ssh -i {key_q} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "
        f"-o UserKnownHostsFile={hosts_q}"
    )


def _write_known_hosts(path: Path, keys: list[str]) -> None:
    if not keys:
        raise ValueError("github ssh_keys list is empty")
    content = "".join(f"github.com {key}\n" for key in keys)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    os.replace(tmp_path, path)
    os.chmod(path, 0o644)


def _default_fetch() -> list[str]:
    response = httpx.get("https://api.github.com/meta", timeout=15)
    response.raise_for_status()
    data = response.json()
    keys_raw = data.get("ssh_keys")
    if not isinstance(keys_raw, list):
        keys_raw = []
    return [str(key) for key in keys_raw]


def ensure_known_hosts(
    settings: Settings,
    fetch: Callable[[], list[str]] | None = None,
    *,
    force: bool = False,
) -> Path:
    path = known_hosts_path(settings)
    if not force and path.is_file():
        lines = [line for line in path.read_text().splitlines() if line.strip()]
        if lines:
            return path
    fetch_fn = fetch if fetch is not None else _default_fetch
    keys = fetch_fn()
    _write_known_hosts(path, keys)
    return path
