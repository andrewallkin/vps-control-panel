import json
import subprocess

import pytest

from vpscp_agent import container_metrics


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("0B", 0),
        ("512B", 512),
        ("1.5KiB", 1536),
        ("100MiB", 100 * 1024**2),
        ("7.7GiB", int(7.7 * 1024**3)),
        ("2kB", 2000),
        ("3MB", 3_000_000),
        (" 1GB ", 1_000_000_000),
    ],
)
def test_parse_size(text, expected):
    assert container_metrics.parse_size(text) == expected


def test_parse_size_rejects_garbage():
    with pytest.raises(ValueError):
        container_metrics.parse_size("lots")


@pytest.mark.parametrize(("text", "expected"), [("0.50%", 0.5), ("12%", 12.0), ("--", 0.0)])
def test_parse_percent(text, expected):
    assert container_metrics.parse_percent(text) == expected


def _fake_docker(ps_output: str, stats_rows: list[dict]):
    def run(args: list[str]) -> str:
        if args[0] == "ps":
            return ps_output
        if args[0] == "stats":
            return "\n".join(json.dumps(row) for row in stats_rows) + "\n"
        raise AssertionError(args)

    return run


def test_collect_containers_groups_by_compose_project():
    run = _fake_docker(
        "spliteasy-backend-1\tspliteasy\npostgres-central\tvpscp\nloose\t\n",
        [
            {
                "Name": "spliteasy-backend-1",
                "CPUPerc": "1.25%",
                "MemUsage": "200MiB / 7.7GiB",
                "MemPerc": "2.54%",
            },
            {
                "Name": "postgres-central",
                "CPUPerc": "0.10%",
                "MemUsage": "50MiB / 7.7GiB",
                "MemPerc": "0.63%",
            },
            {"Name": "loose", "CPUPerc": "0.00%", "MemUsage": "1MiB / 7.7GiB", "MemPerc": "0.01%"},
        ],
    )

    result = container_metrics.collect_containers(run)

    assert [(c.project, c.name) for c in result] == [
        (None, "loose"),
        ("spliteasy", "spliteasy-backend-1"),
        ("vpscp", "postgres-central"),
    ]
    backend = result[1]
    assert backend.cpu_percent == 1.25
    assert backend.mem_used == 200 * 1024**2
    assert backend.mem_limit == int(7.7 * 1024**3)
    assert backend.mem_percent == 2.54


def test_containers_endpoint_returns_503_without_docker(client, monkeypatch):
    def unavailable(*_args, **_kwargs):
        raise FileNotFoundError("docker")

    monkeypatch.setattr(container_metrics, "collect_containers", unavailable)

    response = client.get("/v1/metrics/containers")

    assert response.status_code == 503


def test_containers_endpoint_returns_503_when_docker_fails(client, monkeypatch):
    def failing(*_args, **_kwargs):
        raise subprocess.CalledProcessError(1, ["docker", "stats"])

    monkeypatch.setattr(container_metrics, "collect_containers", failing)

    assert client.get("/v1/metrics/containers").status_code == 503
