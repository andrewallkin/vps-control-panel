import pytest

from vpscp_agent.commands import CommandError, run_command


def test_run_command_ok():
    assert run_command(["echo", "hi"]).stdout == "hi\n"


def test_run_command_extra_env_not_in_args():
    result = run_command(["sh", "-c", 'printf %s "$VPSCP_X"'], extra_env={"VPSCP_X": "s3cret"})
    assert result.stdout == "s3cret"


def test_run_command_error_is_scrubbed():
    with pytest.raises(CommandError) as info:
        run_command(["sh", "-c", "echo password=hunter2 >&2; exit 3"])
    assert "hunter2" not in str(info.value)
    assert info.value.result.returncode == 3


def test_run_command_bytes_input():
    assert run_command(["cat"], input_data=b"abc").stdout == "abc"
