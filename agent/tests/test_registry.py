import json
import stat

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.config import load_settings
from vpscp_agent.credentials import dockerhub_json_path, read_dockerhub_credentials
from vpscp_agent.main import create_app
from vpscp_agent.registry import JWT_CACHE_SECONDS

USERNAME = "dhuser"
TOKEN = "dh-secret-token-xyz"
HUB_JWT = "hub-jwt-abc123-not-user-token"
REPO = "myorg/myapp"


@pytest.fixture
def registry_env(tmp_path):
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
    clock = {"now": 1_000_000.0}

    def monotonic_now() -> float:
        return clock["now"]

    transport_holder: dict[str, httpx.MockTransport | None] = {"transport": None}

    with TestClient(create_app(settings, runner=runner)) as client:
        client.app.state.dockerhub_now = monotonic_now
        yield client, runner, settings, transport_holder, clock


def _set_transport(client: TestClient, holder: dict, handler) -> None:
    transport = httpx.MockTransport(handler)
    holder["transport"] = transport
    client.app.state.dockerhub_transport = transport


def _hub_login_handler(jwt: str = HUB_JWT):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v2/users/login":
            body = json.loads(request.content.decode())
            assert body == {"username": USERNAME, "password": TOKEN}
            return httpx.Response(200, json={"token": jwt})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    return handler


def test_set_credentials_login_json_file_mode_and_status(registry_env):
    client, runner, settings, transport_holder, _clock = registry_env
    _set_transport(client, transport_holder, _hub_login_handler())
    runner.on("docker login")

    response = client.post(
        "/v1/registry/credentials",
        json={"username": USERNAME, "token": TOKEN},
    )
    assert response.status_code == 200
    assert TOKEN not in response.text
    assert HUB_JWT not in response.text

    path = dockerhub_json_path(settings)
    assert path.is_file()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert read_dockerhub_credentials(settings) == (USERNAME, TOKEN)

    status = client.get("/v1/registry/status")
    assert status.status_code == 200
    assert status.json() == {"configured": True, "username": USERNAME}
    assert TOKEN not in status.text
    assert HUB_JWT not in status.text

    login_call = next(c for c in runner.calls if c["args"][:2] == ["docker", "login"])
    assert login_call["args"] == ["docker", "login", "-u", USERNAME, "--password-stdin"]
    assert login_call["input_data"] == TOKEN
    assert TOKEN not in " ".join(login_call["args"])


def test_hub_401_does_not_create_file(registry_env):
    client, runner, settings, transport_holder, _clock = registry_env

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/users/login":
            return httpx.Response(401, json={"detail": "bad credentials"})
        raise AssertionError(request.url.path)

    _set_transport(client, transport_holder, handler)
    response = client.post(
        "/v1/registry/credentials",
        json={"username": USERNAME, "token": TOKEN},
    )
    assert response.status_code == 502
    assert response.json() == {"detail": "Docker Hub login failed"}
    assert TOKEN not in response.text
    assert not dockerhub_json_path(settings).exists()
    assert runner.calls == []


def test_failed_docker_login_does_not_create_file(registry_env):
    client, runner, settings, transport_holder, _clock = registry_env
    _set_transport(client, transport_holder, _hub_login_handler())
    runner.on(
        "docker login",
        returncode=1,
        stderr="denied",
    )

    response = client.post(
        "/v1/registry/credentials",
        json={"username": USERNAME, "token": TOKEN},
    )
    assert response.status_code == 502
    assert TOKEN not in response.text
    assert not dockerhub_json_path(settings).exists()


def test_list_tags_three_pages_and_filtering(registry_env):
    client, runner, _settings, transport_holder, _clock = registry_env
    _set_transport(client, transport_holder, _hub_login_handler())
    runner.on("docker login")
    assert (
        client.post(
            "/v1/registry/credentials",
            json={"username": USERNAME, "token": TOKEN},
        ).status_code
        == 200
    )

    tag_gets: list[str] = []
    page = {"n": 0}

    def tags_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v2/users/login":
            return httpx.Response(200, json={"token": HUB_JWT})
        if request.method == "GET" and "/tags" in request.url.path:
            tag_gets.append(str(request.url))
            assert request.headers.get("Authorization") == f"JWT {HUB_JWT}"
            page["n"] += 1
            if page["n"] == 1:
                assert request.url.params.get("name") == "backend-main-"
            n = page["n"]
            results = []
            if n == 1:
                results = [
                    {
                        "name": "backend-main-abc1234",
                        "last_updated": "2024-01-01T00:00:00Z",
                        "last_pushed": "2024-01-02T00:00:00Z",
                        "digest": "sha256:aaa",
                    },
                    {"name": "backend-main-zz", "last_updated": "2024-01-01T00:00:00Z"},
                    {"name": "other-main-abc1234", "last_updated": "2024-01-01T00:00:00Z"},
                ]
                nxt = "https://hub.docker.com/v2/namespaces/myorg/repositories/myapp/tags?page=2"
            elif n == 2:
                results = [
                    {"name": "backend-main-deadbeef", "last_updated": "2024-01-03T00:00:00Z"}
                ]
                nxt = "https://hub.docker.com/v2/namespaces/myorg/repositories/myapp/tags?page=3"
            elif n == 3:
                results = [
                    {"name": "backend-main-cafebabe", "last_updated": "2024-01-04T00:00:00Z"}
                ]
                nxt = "https://hub.docker.com/v2/namespaces/myorg/repositories/myapp/tags?page=4"
            else:
                raise AssertionError("fourth tag page should not be requested")
            return httpx.Response(200, json={"results": results, "next": nxt})
        raise AssertionError(f"unexpected: {request.method} {request.url}")

    transport_holder["transport"] = httpx.MockTransport(tags_handler)
    client.app.state.dockerhub_transport = transport_holder["transport"]

    response = client.get(
        "/v1/registry/tags",
        params={"repo": REPO, "prefix": "backend", "branch": "main"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(tag_gets) == 3
    names = [item["name"] for item in body]
    assert "backend-main-abc1234" in names
    assert "backend-main-deadbeef" in names
    assert "backend-main-cafebabe" in names
    assert "backend-main-zz" not in names
    assert "other-main-abc1234" not in names

    hit = next(item for item in body if item["name"] == "backend-main-abc1234")
    assert hit["sha"] == "abc1234"
    assert hit["pushed_at"] == "2024-01-02T00:00:00Z"
    assert hit["digest"] == "sha256:aaa"
    assert runner.calls  # docker login from set_credentials only


def test_list_tags_branch_slashes_sanitized(registry_env):
    client, runner, _settings, transport_holder, _clock = registry_env
    _set_transport(client, transport_holder, _hub_login_handler())
    runner.on("docker login")
    client.post(
        "/v1/registry/credentials",
        json={"username": USERNAME, "token": TOKEN},
    )

    seen_names: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/users/login":
            return httpx.Response(200, json={"token": HUB_JWT})
        if "/tags" in request.url.path:
            seen_names.append(request.url.params.get("name"))
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "name": "backend-feature-foo-abc1234",
                            "last_updated": "2024-01-01T00:00:00Z",
                        }
                    ],
                    "next": None,
                },
            )
        raise AssertionError(request.url.path)

    transport_holder["transport"] = httpx.MockTransport(handler)
    client.app.state.dockerhub_transport = transport_holder["transport"]

    response = client.get(
        "/v1/registry/tags",
        params={"repo": REPO, "prefix": "backend", "branch": "feature/foo"},
    )
    assert response.status_code == 200
    assert seen_names == ["backend-feature-foo-"]
    assert response.json()[0]["sha"] == "abc1234"


def test_jwt_cache_reuses_and_expires(registry_env):
    client, runner, _settings, transport_holder, clock = registry_env
    login_posts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/v2/users/login":
            login_posts.append(request)
            return httpx.Response(200, json={"token": HUB_JWT})
        if "/tags" in request.url.path:
            return httpx.Response(
                200,
                json={"results": [], "next": None},
            )
        raise AssertionError(request.url.path)

    _set_transport(client, transport_holder, handler)
    runner.on("docker login")
    client.post(
        "/v1/registry/credentials",
        json={"username": USERNAME, "token": TOKEN},
    )
    login_posts.clear()

    client.get(
        "/v1/registry/tags",
        params={"repo": REPO, "prefix": "backend", "branch": "main"},
    )
    assert len(login_posts) == 0

    client.get(
        "/v1/registry/tags",
        params={"repo": REPO, "prefix": "backend", "branch": "main"},
    )
    assert len(login_posts) == 0

    clock["now"] += JWT_CACHE_SECONDS + 1
    client.get(
        "/v1/registry/tags",
        params={"repo": REPO, "prefix": "backend", "branch": "main"},
    )
    assert len(login_posts) == 1


def test_set_credentials_audited_username_only(registry_env):
    client, runner, _settings, transport_holder, _clock = registry_env
    _set_transport(client, transport_holder, _hub_login_handler())
    runner.on("docker login")
    db = client.app.state.db
    before = len(audit.list_events(db))

    response = client.post(
        "/v1/registry/credentials",
        json={"username": USERNAME, "token": TOKEN},
    )
    assert response.status_code == 200

    events = audit.list_events(db)
    assert len(events) == before + 1
    assert events[0].operation == "registry.set_credentials"
    assert events[0].params == {"username": USERNAME}
    assert TOKEN not in json.dumps(events[0].params)
