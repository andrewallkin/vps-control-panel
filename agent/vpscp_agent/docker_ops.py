from __future__ import annotations

import json
import re

from pydantic import BaseModel

from vpscp_agent.commands import Runner
from vpscp_agent.container_metrics import parse_size

_DF_ARGS = ["docker", "system", "df", "--format", "{{json .}}"]
_PRUNE_ARGS = ["docker", "image", "prune", "-af", "--filter", "until=24h"]

_PERCENT_SUFFIX_RE = re.compile(r"^(.+?) \(\d+%\)$")
_RECLAIMED_RE = re.compile(r"^Total reclaimed space:\s*(.+)\s*$", re.MULTILINE)

_TYPE_TO_KEY = {
    "Images": "images",
    "Containers": "containers",
    "Local Volumes": "volumes",
    "Build Cache": "build_cache",
}


class DiskUsageCategory(BaseModel):
    size_bytes: int
    reclaimable_bytes: int
    count: int


class DockerDiskUsage(BaseModel):
    images: DiskUsageCategory
    containers: DiskUsageCategory
    volumes: DiskUsageCategory
    build_cache: DiskUsageCategory


def _empty_category() -> DiskUsageCategory:
    return DiskUsageCategory(size_bytes=0, reclaimable_bytes=0, count=0)


def _strip_percent_suffix(text: str) -> str:
    stripped = text.strip()
    match = _PERCENT_SUFFIX_RE.match(stripped)
    if match:
        return match.group(1).strip()
    return stripped


def _parse_docker_size(text: str) -> int:
    return parse_size(_strip_percent_suffix(text))


def docker_df(runner: Runner) -> DockerDiskUsage:
    result = runner(_DF_ARGS)
    categories = {key: _empty_category() for key in _TYPE_TO_KEY.values()}
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        key = _TYPE_TO_KEY.get(row["Type"])
        if key is None:
            continue
        categories[key] = DiskUsageCategory(
            size_bytes=_parse_docker_size(row["Size"]),
            reclaimable_bytes=_parse_docker_size(row["Reclaimable"]),
            count=int(row["TotalCount"]),
        )
    return DockerDiskUsage(**categories)


def prune_images(runner: Runner) -> dict[str, int]:
    result = runner(_PRUNE_ARGS)
    match = _RECLAIMED_RE.search(result.stdout)
    if not match:
        raise ValueError("prune output missing Total reclaimed space line")
    reclaimed = _parse_docker_size(match.group(1))
    return {"reclaimed_bytes": reclaimed}
