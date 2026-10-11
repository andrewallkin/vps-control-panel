import pytest
from fastapi.testclient import TestClient

from vpscp_panel.config import PanelSettings
from vpscp_panel.main import create_app


@pytest.fixture
def panel_settings(tmp_path) -> PanelSettings:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!DOCTYPE html><html><body>panel</body></html>")
    (static_dir / "app.js").write_text("// panel-app")
    return PanelSettings(
        PANEL_SECRET_KEY="test-secret-key-for-panel-tests",
        PANEL_DATA_DIR=str(data_dir),
        PANEL_STATIC_DIR=str(static_dir),
    )


@pytest.fixture
def client(panel_settings):
    with TestClient(create_app(settings=panel_settings)) as test_client:
        yield test_client
