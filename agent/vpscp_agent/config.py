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
    pg_container: str
    backup_image: str
    max_upload_bytes: int
    letsencrypt_dir: Path
    nginx_dir: Path
    tls_self_signed: bool
    cloudflare_api_base: str

    @property
    def state_db_path(self) -> Path:
        return self.state_dir / "state.db"

    @property
    def backup_state_dir(self) -> Path:
        return self.state_dir / "backup"

    @property
    def dumps_dir(self) -> Path:
        return self.state_dir / "dumps"

    @property
    def restore_dir(self) -> Path:
        return self.state_dir / "restore"

    @property
    def stack_env_path(self) -> Path:
        return self.stack_dir / ".env"


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    return Settings(
        state_dir=Path(env.get("VPSCP_STATE_DIR", "/var/lib/vpscp")),
        socket_path=Path(env.get("VPSCP_SOCKET_PATH", "/run/vpscp/agent.sock")),
        apps_dir=Path(env.get("VPSCP_APPS_DIR", "/srv/apps")),
        stack_dir=Path(env.get("VPSCP_STACK_DIR", "/srv/vpscp/stack")),
        socket_group=env.get("VPSCP_SOCKET_GROUP", "vpscp"),
        disk_paths=tuple(
            p.strip() for p in env.get("VPSCP_DISK_PATHS", "/").split(",") if p.strip()
        ),
        metrics_interval_seconds=int(env.get("VPSCP_METRICS_INTERVAL", "60")),
        metrics_retention_days=int(env.get("VPSCP_METRICS_RETENTION_DAYS", "7")),
        pg_container=env.get("VPSCP_PG_CONTAINER", "postgres-central"),
        backup_image=env.get("VPSCP_BACKUP_IMAGE", "vpscp-backup:local"),
        max_upload_bytes=int(env.get("VPSCP_MAX_UPLOAD_BYTES", "10737418240")),
        letsencrypt_dir=Path(env.get("VPSCP_LETSENCRYPT_DIR", "/etc/letsencrypt")),
        nginx_dir=Path(env.get("VPSCP_NGINX_DIR", "/etc/nginx")),
        tls_self_signed=env.get("VPSCP_TLS_SELF_SIGNED") == "1",
        cloudflare_api_base=env.get("VPSCP_CLOUDFLARE_API", "https://api.cloudflare.com/client/v4"),
    )
