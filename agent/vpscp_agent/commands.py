import os
import subprocess
import threading
from collections.abc import Callable, Iterator, Mapping
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

    def stream_to_file(
        self,
        args: list[str],
        path: Path,
        timeout: float | None = 120,
    ) -> None: ...

    def pipe_through(
        self,
        args: list[str],
        source: Iterator[bytes],
        on_line: Callable[[str], None],
        timeout: float | None = 120,
    ) -> int: ...


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


def stream_to_file(
    args: list[str],
    path: Path,
    timeout: float | None = 120,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "wb") as stdout_file:
            proc = subprocess.Popen(
                args,
                stdout=stdout_file,
                stderr=subprocess.PIPE,
                env=os.environ,
            )
            try:
                _, stderr_bytes = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                path.unlink(missing_ok=True)
                raise
        stderr = (stderr_bytes or b"").decode(errors="replace")
        result = CommandResult(proc.returncode or 0, "", stderr)
        if result.returncode != 0:
            path.unlink(missing_ok=True)
            raise CommandError(result)
    except CommandError:
        raise
    except Exception:
        path.unlink(missing_ok=True)
        raise


def pipe_through(
    args: list[str],
    source: Iterator[bytes],
    on_line: Callable[[str], None],
    timeout: float | None = 120,
) -> int:
    proc = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=os.environ,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    def writer() -> None:
        try:
            for chunk in source:
                proc.stdin.write(chunk)
            proc.stdin.close()
        except Exception:
            proc.kill()
            raise

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    try:
        while True:
            raw = proc.stdout.readline()
            if not raw:
                break
            on_line(raw.decode(errors="replace").rstrip("\n\r"))
        thread.join(timeout=timeout)
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        thread.join()
        raise
    return proc.returncode or 0


run_command.stream_to_file = stream_to_file  # type: ignore[attr-defined]
run_command.pipe_through = pipe_through  # type: ignore[attr-defined]
