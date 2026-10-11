from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PanelSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", populate_by_name=True)

    panel_secret_key: str = Field(validation_alias="PANEL_SECRET_KEY")
    panel_data_dir: Path = Field(default=Path("/data"), validation_alias="PANEL_DATA_DIR")
    agent_socket: Path = Field(
        default=Path("/run/vpscp/agent.sock"),
        validation_alias="AGENT_SOCKET",
    )
    panel_static_dir: Path = Field(
        default=Path("/app/static"),
        validation_alias="PANEL_STATIC_DIR",
    )
    panel_cookie_secure: bool = Field(default=True, validation_alias="PANEL_COOKIE_SECURE")

    @field_validator("panel_data_dir", "agent_socket", "panel_static_dir", mode="before")
    @classmethod
    def _coerce_path(cls, value: str | Path) -> Path:
        return Path(value)

    @field_validator("panel_cookie_secure", mode="before")
    @classmethod
    def _coerce_cookie_secure(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def panel_db_path(self) -> Path:
        return self.panel_data_dir / "panel.db"
