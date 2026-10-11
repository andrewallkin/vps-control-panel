import time
from collections.abc import Iterable
from datetime import UTC, datetime

import psutil
from pydantic import BaseModel


class DiskUsage(BaseModel):
    path: str
    total: int
    used: int
    free: int
    percent: float


class HostMetrics(BaseModel):
    ts: str
    cpu_percent: float
    cpu_count: int
    load1: float
    load5: float
    load15: float
    mem_total: int
    mem_available: int
    mem_used: int
    mem_percent: float
    swap_total: int
    swap_used: int
    uptime_seconds: int
    disks: list[DiskUsage]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def collect_disks(paths: Iterable[str]) -> list[DiskUsage]:
    disks = []
    for path in paths:
        usage = psutil.disk_usage(path)
        disks.append(
            DiskUsage(
                path=path,
                total=usage.total,
                used=usage.used,
                free=usage.free,
                percent=usage.percent,
            )
        )
    return disks


def collect_host(disk_paths: Iterable[str], cpu_interval: float = 0.5) -> HostMetrics:
    memory = psutil.virtual_memory()
    swap = psutil.swap_memory()
    load1, load5, load15 = psutil.getloadavg()
    mem_used = memory.total - memory.available
    return HostMetrics(
        ts=_now_iso(),
        cpu_percent=psutil.cpu_percent(interval=cpu_interval),
        cpu_count=psutil.cpu_count() or 1,
        load1=load1,
        load5=load5,
        load15=load15,
        mem_total=memory.total,
        mem_available=memory.available,
        mem_used=mem_used,
        mem_percent=round(mem_used / memory.total * 100, 1),
        swap_total=swap.total,
        swap_used=swap.used,
        uptime_seconds=int(time.time() - psutil.boot_time()),
        disks=collect_disks(disk_paths),
    )
