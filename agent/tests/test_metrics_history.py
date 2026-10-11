import time
from datetime import UTC, datetime, timedelta

import pytest

from vpscp_agent import metrics
from vpscp_agent.state import StateDB


@pytest.fixture
def db(tmp_path) -> StateDB:
    state = StateDB(tmp_path / "state.db")
    state.migrate()
    return state


def _sample(ts: datetime, cpu: float = 10.0) -> metrics.HostMetrics:
    return metrics.HostMetrics(
        ts=ts.isoformat(timespec="seconds"),
        cpu_percent=cpu,
        cpu_count=2,
        load1=0.5,
        load5=0.4,
        load15=0.3,
        mem_total=8_000,
        mem_available=3_000,
        mem_used=5_000,
        mem_percent=62.5,
        swap_total=4_000,
        swap_used=100,
        uptime_seconds=1_000,
        disks=[metrics.DiskUsage(path="/", total=100, used=40, free=60, percent=40.0)],
    )


def test_history_rejects_naive_since(db):
    with pytest.raises(ValueError, match="timezone-aware"):
        metrics.history(db, since=datetime.now())


def test_history_returns_samples_since_oldest_first(db):
    now = datetime.now(UTC).replace(microsecond=0)
    metrics.store_sample(db, _sample(now - timedelta(hours=30), cpu=1))
    metrics.store_sample(db, _sample(now - timedelta(hours=2), cpu=2))
    metrics.store_sample(db, _sample(now - timedelta(minutes=1), cpu=3))

    points = metrics.history(db, since=now - timedelta(hours=24))

    assert [p.cpu_percent for p in points] == [2, 3]
    assert points[0].mem_used == 5_000
    assert points[0].mem_total == 8_000
    assert points[0].disks[0].path == "/"


def test_store_sample_replaces_same_timestamp(db):
    now = datetime.now(UTC).replace(microsecond=0)
    metrics.store_sample(db, _sample(now, cpu=1))
    metrics.store_sample(db, _sample(now, cpu=2))

    [point] = metrics.history(db, since=now - timedelta(minutes=1))
    assert point.cpu_percent == 2


def test_prune_deletes_old_samples(db):
    now = datetime.now(UTC).replace(microsecond=0)
    metrics.store_sample(db, _sample(now - timedelta(days=8)))
    metrics.store_sample(db, _sample(now - timedelta(days=1)))

    deleted = metrics.prune(db, older_than=now - timedelta(days=7))

    assert deleted == 1
    assert len(metrics.history(db, since=now - timedelta(days=30))) == 1


def test_sampler_stores_a_sample_on_startup(client):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        body = client.get("/v1/metrics/history", params={"hours": 1}).json()
        if body:
            break
        time.sleep(0.1)

    assert len(body) >= 1
    assert body[0]["mem_total"] > 0


def test_history_endpoint_validates_hours(client):
    assert client.get("/v1/metrics/history", params={"hours": 0}).status_code == 422
    assert client.get("/v1/metrics/history", params={"hours": 169}).status_code == 422
