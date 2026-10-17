from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel

from vpscp_agent.commands import Runner
from vpscp_agent.container_metrics import parse_size

_DF_ARGS = ["docker", "system", "df", "--format", "{{json .}}"]
_PRUNE_ARGS = ["docker", "image", "prune", "-af", "--filter", "until=24h"]
_PRUNE_BUILD_CACHE_ARGS = ["docker", "builder", "prune", "-af", "--filter", "until=24h"]

_PERCENT_SUFFIX_RE = re.compile(r"^(.+?) \(\d+%\)$")
_RECLAIMED_RE = re.compile(r"^Total reclaimed space:\s*(.+)\s*$", re.MULTILINE)
_BUILDX_TOTAL_RE = re.compile(r"^Total:\s+(.+)\s*$", re.MULTILINE)

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


def _parse_prune_reclaimed_bytes(stdout: str) -> int:
    match = _RECLAIMED_RE.search(stdout)
    if match:
        return _parse_docker_size(match.group(1))
    for buildx_match in _BUILDX_TOTAL_RE.finditer(stdout):
        size_part = buildx_match.group(1).strip()
        if size_part.lower().startswith("reclaimed"):
            continue
        return _parse_docker_size(size_part)
    raise ValueError("prune output missing Total reclaimed space line")


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
    return {"reclaimed_bytes": _parse_prune_reclaimed_bytes(result.stdout)}


_PS_ARGS = ["docker", "ps", "--format", "{{json .}}"]

_PS_PORT_PATTERN = re.compile(
    r"^(?:(?:\[(?P<ip6>[^\]]+)\]|(?P<ip>[^:\s\[]+)):)?(?P<host>\d+)->(?P<container>\d+)/(?:tcp|udp)$"
)


def _parse_labels(raw: Any) -> dict[str, str]:
    """Parse docker ps labels, which may be a dict or a comma-joined string."""
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return {}
    labels: dict[str, str] = {}
    for part in raw.split(","):
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        labels[key.strip()] = value.strip()
    return labels


def _ports_from_ps_string(raw: str) -> list[dict[str, int | str]]:
    """Parse docker ps Ports entries like '0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp'."""
    ports: list[dict[str, int | str]] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        match = _PS_PORT_PATTERN.match(part)
        if match is None:
            continue
        ip6 = match.group("ip6")
        ip = ip6 if ip6 is not None else (match.group("ip") or "")
        ports.append(
            {
                "ip": ip,
                "host_port": int(match.group("host")),
                "container_port": int(match.group("container")),
            }
        )
    return ports


def container_host_ports(runner: Runner) -> list[dict[str, Any]]:
    """Published host port bindings grouped by compose project and service."""
    result = runner(_PS_ARGS)
    bindings: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        network = row.get("NetworkSettings") or {}
        raw_ports = network.get("Ports") or {}
        ports: list[dict[str, int | str]] = []
        if isinstance(raw_ports, dict):
            for container_port, mappings in raw_ports.items():
                if not isinstance(mappings, list):
                    continue
                container_number = int(container_port.split("/")[0])
                for mapping in mappings:
                    host_port = mapping.get("HostPort")
                    if host_port is None:
                        continue
                    ports.append(
                        {
                            "ip": str(mapping.get("HostIp") or ""),
                            "host_port": int(host_port),
                            "container_port": container_number,
                        }
                    )
        if not ports:
            ports = _ports_from_ps_string(str(row.get("Ports") or ""))
        if not ports:
            continue
        labels = _parse_labels(row.get("Labels"))
        bindings.append(
            {
                "project": labels.get("com.docker.compose.project"),
                "service": labels.get("com.docker.compose.service"),
                "container": row.get("Names") or "",
                "ports": ports,
            }
        )
    return bindings


def prune_build_cache(runner: Runner) -> dict[str, int]:
    result = runner(_PRUNE_BUILD_CACHE_ARGS)
    return {"reclaimed_bytes": _parse_prune_reclaimed_bytes(result.stdout)}
