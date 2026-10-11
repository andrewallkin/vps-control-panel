import os
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from vpscp_agent.audit import scrub_error_message


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


class CommandError(Exception):
    def __init__(self, result: CommandResult) -> None:
        self.result = result
        tail = result.stderr[-2000:]
        super().__init__(scrub_error_message(tail))


class Runner(Protocol):
    def __call__(
        self,
        args: list[str],
        *,
        input_data: bytes | str | None = None,
        extra_env: Mapping[str, str] | None = None,
        timeout: float | None = 120,
        check: bool = True,
        cwd: Path | None = None,
    ) -> CommandResult: ...


def _finish(result: CommandResult, *, check: bool) -> CommandResult:
    if check and result.returncode != 0:
        raise CommandError(result)
    return result


def run_command(
    args: list[str],
    *,
    input_data: bytes | str | None = None,
    extra_env: Mapping[str, str] | None = None,
    timeout: float | None = 120,
    check: bool = True,
    cwd: Path | None = None,
) -> CommandResult:
    env: dict[str, str] = dict(os.environ)
    if extra_env is not None:
        env.update(extra_env)

    text_mode = input_data is None or isinstance(input_data, str)
    if text_mode:
        completed = subprocess.run(
            args,
            input=input_data,
            capture_output=True,
            check=False,
            env=env,
            timeout=timeout,
            cwd=cwd,
            text=True,
            errors="replace",
        )
    else:
        completed = subprocess.run(
            args,
            input=input_data,
            capture_output=True,
            check=False,
            env=env,
            timeout=timeout,
            cwd=cwd,
            text=False,
        )
    if text_mode:
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
    else:
        stdout = (completed.stdout or b"").decode(errors="replace")
        stderr = (completed.stderr or b"").decode(errors="replace")

    result = CommandResult(completed.returncode, stdout, stderr)
    return _finish(result, check=check)
