import asyncio
import json
import logging
import time
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

import psutil
from pydantic import BaseModel

from vpscp_agent.state import StateDB

logger = logging.getLogger(__name__)


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


class MetricPoint(BaseModel):
    ts: str
    cpu_percent: float
    load1: float
    mem_used: int
    mem_total: int
    swap_used: int
    swap_total: int
    disks: list[DiskUsage]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def collect_disks(paths: Iterable[str]) -> list[DiskUsage]:
    disks = []
    for path in paths:
        try:
            usage = psutil.disk_usage(path)
        except OSError as exc:
            logger.warning("disk usage unavailable for %s: %s", path, exc)
            continue
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


def store_sample(db: StateDB, sample: HostMetrics) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO metric_sample (ts, cpu_percent, load1, load5, load15, "
            "mem_total, mem_available, swap_total, swap_used, disks_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                sample.ts,
                sample.cpu_percent,
                sample.load1,
                sample.load5,
                sample.load15,
                sample.mem_total,
                sample.mem_available,
                sample.swap_total,
                sample.swap_used,
                json.dumps([disk.model_dump() for disk in sample.disks]),
            ),
        )


def history(db: StateDB, since: datetime) -> list[MetricPoint]:
    if since.tzinfo is None or since.tzinfo.utcoffset(since) is None:
        raise ValueError("since must be a timezone-aware datetime")
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM metric_sample WHERE ts >= ? ORDER BY ts",
            (since.astimezone(UTC).isoformat(timespec="seconds"),),
        ).fetchall()
    return [
        MetricPoint(
            ts=row["ts"],
            cpu_percent=row["cpu_percent"],
            load1=row["load1"],
            mem_used=row["mem_total"] - row["mem_available"],
            mem_total=row["mem_total"],
            swap_used=row["swap_used"],
            swap_total=row["swap_total"],
            disks=[DiskUsage(**disk) for disk in json.loads(row["disks_json"])],
        )
        for row in rows
    ]


def prune(db: StateDB, older_than: datetime) -> int:
    with db.connect() as conn:
        cursor = conn.execute(
            "DELETE FROM metric_sample WHERE ts < ?",
            (older_than.astimezone(UTC).isoformat(timespec="seconds"),),
        )
        return cursor.rowcount


async def run_sampler(
    db: StateDB,
    disk_paths: Iterable[str],
    interval_seconds: int,
    retention_days: int,
    stop: asyncio.Event,
) -> None:
    paths = tuple(disk_paths)
    while not stop.is_set():
        try:
            sample = await asyncio.to_thread(collect_host, paths)
            store_sample(db, sample)
            prune(db, older_than=datetime.now(UTC) - timedelta(days=retention_days))
        except Exception:
            logger.exception("metrics sample failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except TimeoutError:
            pass
