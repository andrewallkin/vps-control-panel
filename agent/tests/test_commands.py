import gzip
import subprocess
from pathlib import Path

import pytest

from vpscp_agent.commands import CommandError, run_command, stream_to_gzip_file


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


def test_stream_to_gzip_file_compresses_stdout(tmp_path: Path) -> None:
    out = tmp_path / "out.gz"
    stream_to_gzip_file(["sh", "-c", "printf hello"], out)
    assert gzip.decompress(out.read_bytes()) == b"hello"


def test_stream_to_gzip_file_times_out_while_stdout_open(tmp_path: Path) -> None:
    out = tmp_path / "slow.gz"
    with pytest.raises(subprocess.TimeoutExpired):
        stream_to_gzip_file(["sleep", "30"], out, timeout=1)
    assert not out.exists()
