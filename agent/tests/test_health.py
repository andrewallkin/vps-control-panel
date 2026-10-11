from vpscp_agent.config import load_settings


def test_health_reports_ok_and_version(client):
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_load_settings_defaults():
    settings = load_settings({})

    assert str(settings.state_dir) == "/var/lib/vpscp"
    assert str(settings.socket_path) == "/run/vpscp/agent.sock"
    assert str(settings.apps_dir) == "/srv/apps"
    assert str(settings.stack_dir) == "/srv/vpscp/stack"
    assert settings.socket_group == "vpscp"
    assert settings.disk_paths == ("/",)
    assert settings.metrics_interval_seconds == 60
    assert settings.metrics_retention_days == 7
    assert str(settings.state_db_path) == "/var/lib/vpscp/state.db"


def test_load_settings_splits_disk_paths():
    settings = load_settings({"VPSCP_DISK_PATHS": "/,/srv"})

    assert settings.disk_paths == ("/", "/srv")


def test_load_settings_strips_disk_paths_and_drops_empty():
    settings = load_settings({"VPSCP_DISK_PATHS": " / , , /srv , "})

    assert settings.disk_paths == ("/", "/srv")
