import pytest
from fastapi.testclient import TestClient

from vpscp_agent.config import Settings, load_settings
from vpscp_agent.main import create_app


@pytest.fixture
def settings(tmp_path) -> Settings:
    return load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client
