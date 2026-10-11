from __future__ import annotations

import os
from pathlib import Path

from vpscp_agent.commands import Runner
from vpscp_agent.config import Settings
from vpscp_agent.db_ops import NotFoundError
from vpscp_agent.projects import get_project_row
from vpscp_agent.state import StateDB


def deploy_keys_dir(settings: Settings) -> Path:
    return settings.state_dir / "deploy-keys"


def deploy_key_private_path(settings: Settings, slug: str) -> Path:
    return deploy_keys_dir(settings) / slug


def deploy_key_public_path(settings: Settings, slug: str) -> Path:
    private = deploy_key_private_path(settings, slug)
    return private.with_suffix(private.suffix + ".pub")


def ensure_deploy_key(
    settings: Settings,
    db: StateDB,
    runner: Runner,
    *,
    slug: str,
) -> str:
    if get_project_row(db, slug) is None:
        raise NotFoundError(f"project not found: {slug!r}")

    key_dir = deploy_keys_dir(settings)
    key_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(key_dir, 0o700)

    private_path = deploy_key_private_path(settings, slug)
    public_path = deploy_key_public_path(settings, slug)

    if not private_path.is_file():
        runner(
            [
                "ssh-keygen",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                f"vpscp-{slug}",
                "-f",
                str(private_path),
            ],
            check=True,
        )
        os.chmod(private_path, 0o600)

    return public_path.read_text().strip()
