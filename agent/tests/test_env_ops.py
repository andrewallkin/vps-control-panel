import json
import stat

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.config import load_settings
from vpscp_agent.envfile import EnvFile, read_env, write_env_atomic
from vpscp_agent.main import create_app
from vpscp_agent.validation import safe_project_path

DEFAULT_BODY = {
    "slug": "budget-hq",
    "repo_url": "git@github.com:owner/repo.git",
    "branch": "main",
    "compose_file": "docker-compose.yml",
    "deploy_mode": "build",
}

MASK_PREFIX = "\u2022" * 4


@pytest.fixture
def env_client(tmp_path):
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(tmp_path / "agent.sock"),
            "VPSCP_APPS_DIR": str(tmp_path / "apps"),
            "VPSCP_STACK_DIR": str(tmp_path / "stack"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        client.post("/v1/projects", json=DEFAULT_BODY)
        yield client, settings


def test_mask_short_empty_and_reveal(env_client):
    client, settings = env_client
    slug = "budget-hq"
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    env_path.parent.mkdir(parents=True, exist_ok=True)
    write_env_atomic(
        env_path,
        EnvFile.parse("SEVEN=1234567\nEIGHT=abcdefgh\nEMPTY=\n"),
    )

    masked = client.get(f"/v1/projects/{slug}/env")
    assert masked.status_code == 200
    by_key = {e["key"]: e["value"] for e in masked.json()["entries"]}
    assert by_key["SEVEN"] == MASK_PREFIX
    assert by_key["EIGHT"] == f"{MASK_PREFIX}gh"
    assert by_key["EMPTY"] == MASK_PREFIX

    revealed = client.get(f"/v1/projects/{slug}/env", params={"reveal": "true"})
    assert revealed.status_code == 200
    by_key_r = {e["key"]: e["value"] for e in revealed.json()["entries"]}
    assert by_key_r["EIGHT"] == "abcdefgh"


def test_put_valid_content_mode_600_and_get_masked(env_client):
    client, settings = env_client
    slug = "budget-hq"
    content = "FOO=bar\n\n# comment\n"
    response = client.put(f"/v1/projects/{slug}/env", json={"content": content})
    assert response.status_code == 200

    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    assert env_path.read_text() == content if content.endswith("\n") else content + "\n"
    mode = stat.S_IMODE(env_path.stat().st_mode)
    assert mode == 0o600

    get_resp = client.get(f"/v1/projects/{slug}/env")
    assert get_resp.status_code == 200
    entries = get_resp.json()["entries"]
    assert entries == [{"key": "FOO", "value": MASK_PREFIX}]


def test_put_invalid_line_leaves_file_unchanged(env_client):
    client, settings = env_client
    slug = "budget-hq"
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    env_path.parent.mkdir(parents=True, exist_ok=True)
    original = "KEEP=yes\n"
    write_env_atomic(env_path, EnvFile.parse(original))

    response = client.put(f"/v1/projects/{slug}/env", json={"content": "not valid\n"})
    assert response.status_code == 400
    assert env_path.read_text() == original


def test_put_duplicate_key_returns_400(env_client):
    client, _settings = env_client
    slug = "budget-hq"
    response = client.put(
        f"/v1/projects/{slug}/env",
        json={"content": "FOO=1\nFOO=2\n"},
    )
    assert response.status_code == 400


def test_patch_set_unset_and_audit(env_client):
    client, settings = env_client
    slug = "budget-hq"
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    env_path.parent.mkdir(parents=True, exist_ok=True)
    write_env_atomic(env_path, EnvFile.parse("FOO=old\n"))

    db = client.app.state.db
    before = len(audit.list_events(db))

    response = client.patch(
        f"/v1/projects/{slug}/env",
        json={"set": {"BAR": "secretvalue"}, "unset": ["FOO"]},
    )
    assert response.status_code == 200

    env = read_env(env_path)
    assert env.keys() == ["BAR"]
    assert env.get("BAR") == "secretvalue"
    assert env.get("FOO") is None

    events = audit.list_events(db)
    assert len(events) == before + 1
    last = events[0]
    assert last.operation == "env.patch"
    params = last.params
    assert params["slug"] == slug
    assert params["set"] == ["BAR"]
    assert params["unset"] == ["FOO"]
    assert "secretvalue" not in json.dumps(params)


def test_get_not_audited(env_client):
    client, settings = env_client
    slug = "budget-hq"
    env_path = safe_project_path(settings.apps_dir, slug, ".env")
    env_path.parent.mkdir(parents=True, exist_ok=True)
    write_env_atomic(env_path, EnvFile.parse("A=1\n"))

    db = client.app.state.db
    before = len(audit.list_events(db))
    assert client.get(f"/v1/projects/{slug}/env").status_code == 200
    assert len(audit.list_events(db)) == before


def test_unknown_slug_404(env_client):
    client, _settings = env_client
    assert client.get("/v1/projects/no-such/env").status_code == 404


def test_unset_many_missing_key_no_raise():
    env = EnvFile.parse("A=1\n")
    env.unset_many(["MISSING"])
    assert env.get("A") == "1"
