import json
import re
import subprocess
from collections.abc import Callable

from pydantic import BaseModel

_SIZE_RE = re.compile(r"^\s*([\d.]+)\s*([A-Za-z]+)\s*$")
_SIZE_UNITS = {
    "B": 1,
    "kB": 1000,
    "KB": 1000,
    "MB": 1000**2,
    "GB": 1000**3,
    "TB": 1000**4,
    "KiB": 1024,
    "MiB": 1024**2,
    "GiB": 1024**3,
    "TiB": 1024**4,
}


class ContainerMetrics(BaseModel):
    name: str
    project: str | None
    cpu_percent: float
    mem_used: int
    mem_limit: int
    mem_percent: float


def parse_size(text: str) -> int:
    match = _SIZE_RE.match(text)
    if not match or match.group(2) not in _SIZE_UNITS:
        raise ValueError(f"unrecognised size: {text!r}")
    return int(float(match.group(1)) * _SIZE_UNITS[match.group(2)])


def parse_percent(text: str) -> float:
    cleaned = text.strip().rstrip("%")
    if cleaned in ("", "--"):
        return 0.0
    return float(cleaned)


def run_docker(args: list[str]) -> str:
    completed = subprocess.run(
        ["docker", *args], capture_output=True, text=True, check=True, timeout=30
    )
    return completed.stdout


def collect_containers(run: Callable[[list[str]], str] = run_docker) -> list[ContainerMetrics]:
    projects: dict[str, str | None] = {}
    ps_format = '{{.Names}}\t{{.Label "com.docker.compose.project"}}'
    for line in run(["ps", "--format", ps_format]).splitlines():
        if not line.strip():
            continue
        name, _, project = line.partition("\t")
        projects[name] = project or None

    result = []
    for line in run(["stats", "--no-stream", "--format", "{{json .}}"]).splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        used_text, _, limit_text = row["MemUsage"].partition("/")
        result.append(
            ContainerMetrics(
                name=row["Name"],
                project=projects.get(row["Name"]),
                cpu_percent=parse_percent(row["CPUPerc"]),
                mem_used=parse_size(used_text),
                mem_limit=parse_size(limit_text),
                mem_percent=parse_percent(row["MemPerc"]),
            )
        )
    return sorted(result, key=lambda c: (c.project or "", c.name))
