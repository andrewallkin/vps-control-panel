import stat

import pytest

from vpscp_agent.config import Settings, load_settings
from vpscp_agent.github_keys import ensure_known_hosts, git_ssh_command


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


def test_git_ssh_command_quotes_paths():
    cmd = git_ssh_command("/var/lib/vpscp/deploy-keys/myapp", "/var/lib/vpscp/known_hosts")
    assert "IdentitiesOnly=yes" in cmd
    assert "StrictHostKeyChecking=yes" in cmd
    assert "UserKnownHostsFile=" in cmd
    assert cmd.startswith("ssh -i ")


def test_ensure_known_hosts_writes_github_lines(settings: Settings):
    fetch_calls: list[None] = []

    def fetch() -> list[str]:
        fetch_calls.append(None)
        return ["ssh-ed25519 AAAATEST", "ecdsa-sha2-nistp256 BBBTEST"]

    path = ensure_known_hosts(settings, fetch=fetch)

    assert path == settings.state_dir / "known_hosts"
    assert len(fetch_calls) == 1
    content = path.read_text()
    assert content == "github.com ssh-ed25519 AAAATEST\ngithub.com ecdsa-sha2-nistp256 BBBTEST\n"
    assert stat.S_IMODE(path.stat().st_mode) == 0o644


def test_ensure_known_hosts_skips_fetch_when_file_has_content(settings: Settings):
    path = settings.state_dir / "known_hosts"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("github.com ssh-ed25519 EXISTING\n")

    def fetch() -> list[str]:
        raise AssertionError("fetch should not be called")

    result = ensure_known_hosts(settings, fetch=fetch)

    assert result == path
    assert path.read_text() == "github.com ssh-ed25519 EXISTING\n"


def test_ensure_known_hosts_raises_on_empty_key_list(settings: Settings):
    with pytest.raises(ValueError):
        ensure_known_hosts(settings, fetch=list)


def test_ensure_known_hosts_force_refreshes_existing_content(settings: Settings):
    path = settings.state_dir / "known_hosts"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("github.com ssh-ed25519 EXISTING\n")

    def fetch() -> list[str]:
        return ["ssh-ed25519 REFRESHED"]

    result = ensure_known_hosts(settings, fetch=fetch, force=True)

    assert result == path
    assert path.read_text() == "github.com ssh-ed25519 REFRESHED\n"


def test_ensure_known_hosts_atomic_replace(settings: Settings, tmp_path):
    path = settings.state_dir / "known_hosts"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n")

    ensure_known_hosts(settings, fetch=lambda: ["ssh-ed25519 NEWKEY"])

    assert path.read_text() == "github.com ssh-ed25519 NEWKEY\n"
