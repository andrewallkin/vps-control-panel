import gzip
from collections.abc import Callable, Iterator
from pathlib import Path

from vpscp_agent.commands import CommandError, CommandResult


class FakeRunner:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.stream_calls: list[dict] = []
        self.stream_gzip_calls: list[dict] = []
        self.pipe_through_calls: list[dict] = []
        self.pipe_through_lines: list[str] = []
        self.pipe_through_returncode: int = 0
        self.stream_payload: bytes = b"PGDMP-fake-dump"
        self.responses: list[tuple[Callable[[list[str]], bool], CommandResult | Exception]] = []

    def set_pipe_through(self, *, lines: list[str], returncode: int = 0) -> None:
        self.pipe_through_lines = list(lines)
        self.pipe_through_returncode = returncode

    def __call__(
        self,
        args: list[str],
        *,
        input_data: bytes | str | None = None,
        extra_env: dict[str, str] | None = None,
        timeout: float | None = 120,
        check: bool = True,
        cwd=None,
    ) -> CommandResult:
        self.calls.append(
            {
                "args": args,
                "input_data": input_data,
                "extra_env": extra_env,
                "cwd": cwd,
                "timeout": timeout,
            }
        )
        for predicate, response in self.responses:
            if predicate(args):
                if isinstance(response, Exception):
                    raise response
                if check and response.returncode != 0:
                    raise CommandError(response)
                return response
        result = CommandResult(0, "", "")
        if check and result.returncode != 0:
            raise CommandError(result)
        return result

    def on(
        self,
        match: Callable[[list[str]], bool] | str,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
    ) -> None:
        if isinstance(match, str):
            needle = match

            def predicate(args: list[str]) -> bool:
                if needle in " ".join(args):
                    return True
                call = self.calls[-1]
                input_data = call.get("input_data")
                return isinstance(input_data, str) and needle in input_data

        else:
            predicate = match
        self.responses.append((predicate, CommandResult(returncode, stdout, stderr)))

    def stream_to_file(
        self,
        args: list[str],
        path: Path,
        timeout: float | None = 120,
    ) -> None:
        self.stream_calls.append({"args": args, "path": path, "timeout": timeout})
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.stream_payload)

    def stream_to_gzip_file(
        self,
        args: list[str],
        path: Path,
        timeout: float | None = 120,
    ) -> None:
        self.stream_gzip_calls.append({"args": args, "path": path, "timeout": timeout})
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wb") as handle:
            handle.write(self.stream_payload)

    def pipe_through(
        self,
        args: list[str],
        source: Iterator[bytes],
        on_line: Callable[[str], None],
        timeout: float | None = 120,
    ) -> int:
        joined = b"".join(source)
        self.pipe_through_calls.append({"args": args, "source": joined, "timeout": timeout})
        for line in self.pipe_through_lines:
            on_line(line)
        return self.pipe_through_returncode
