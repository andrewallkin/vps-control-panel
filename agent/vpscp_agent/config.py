import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    state_dir: Path
    socket_path: Path
    apps_dir: Path
    stack_dir: Path
    socket_group: str
    disk_paths: tuple[str, ...]
    metrics_interval_seconds: int
    metrics_retention_days: int

    @property
    def state_db_path(self) -> Path:
        return self.state_dir / "state.db"


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    return Settings(
        state_dir=Path(env.get("VPSCP_STATE_DIR", "/var/lib/vpscp")),
        socket_path=Path(env.get("VPSCP_SOCKET_PATH", "/run/vpscp/agent.sock")),
        apps_dir=Path(env.get("VPSCP_APPS_DIR", "/srv/apps")),
        stack_dir=Path(env.get("VPSCP_STACK_DIR", "/srv/vpscp/stack")),
        socket_group=env.get("VPSCP_SOCKET_GROUP", "vpscp"),
        disk_paths=tuple(p for p in env.get("VPSCP_DISK_PATHS", "/").split(",") if p),
        metrics_interval_seconds=int(env.get("VPSCP_METRICS_INTERVAL", "60")),
        metrics_retention_days=int(env.get("VPSCP_METRICS_RETENTION_DAYS", "7")),
    )
