from collections.abc import Callable

from vpscp_agent.commands import CommandError, CommandResult


class FakeRunner:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.responses: list[tuple[Callable[[list[str]], bool], CommandResult | Exception]] = []

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
