import shutil
import stat
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn

from vpscp_agent.config import load_settings
from vpscp_agent.main import create_app
from vpscp_agent.server import bind_socket


@pytest.fixture
def short_dir():
    # macOS limits unix socket paths to ~104 bytes, so avoid pytest's long tmp_path.
    path = Path(tempfile.mkdtemp(prefix="vpscp-", dir="/tmp"))
    yield path
    shutil.rmtree(path, ignore_errors=True)


def test_bind_socket_sets_mode_660(short_dir):
    path = short_dir / "run" / "agent.sock"

    sock = bind_socket(path, group=None)
    try:
        assert stat.S_ISSOCK(path.stat().st_mode)
        assert stat.S_IMODE(path.stat().st_mode) == 0o660
    finally:
        sock.close()


def test_bind_socket_applies_group_gid(short_dir, monkeypatch):
    path = short_dir / "agent.sock"
    chown_calls: list[tuple] = []

    class FakeGroup:
        gr_gid = 42

    monkeypatch.setattr("vpscp_agent.server.grp.getgrnam", lambda name: FakeGroup())
    monkeypatch.setattr(
        "vpscp_agent.server.os.chown",
        lambda p, uid, gid: chown_calls.append((p, uid, gid)),
    )

    sock = bind_socket(path, group="vpscp")
    try:
        assert chown_calls == [(path, -1, 42)]
    finally:
        sock.close()


def test_bind_socket_replaces_stale_socket(short_dir):
    path = short_dir / "agent.sock"
    bind_socket(path, group=None).close()

    sock = bind_socket(path, group=None)
    sock.close()

    assert path.exists()


def test_server_answers_health_over_unix_socket(short_dir, tmp_path):
    settings = load_settings(
        {
            "VPSCP_STATE_DIR": str(tmp_path / "state"),
            "VPSCP_SOCKET_PATH": str(short_dir / "agent.sock"),
            "VPSCP_DISK_PATHS": str(tmp_path),
            "VPSCP_METRICS_INTERVAL": "3600",
        }
    )
    sock = bind_socket(settings.socket_path, group=None)
    server = uvicorn.Server(uvicorn.Config(create_app(settings), log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started

        transport = httpx.HTTPTransport(uds=str(settings.socket_path))
        with httpx.Client(transport=transport, base_url="http://agent") as http:
            response = http.get("/v1/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
