import json
import subprocess

import pytest
from fastapi.testclient import TestClient

from tests.fakes import FakeRunner
from vpscp_agent import audit
from vpscp_agent.commands import CommandError, CommandResult
from vpscp_agent.docker_ops import (
    container_host_ports,
    docker_df,
    prune_build_cache,
    prune_images,
)
from vpscp_agent.main import create_app

DF_ARGS = ["docker", "system", "df", "--format", "{{json .}}"]
PRUNE_ARGS = ["docker", "image", "prune", "-af", "--filter", "until=24h"]
PRUNE_BUILD_CACHE_ARGS = [
    "docker",
    "builder",
    "prune",
    "-af",
    "--filter",
    "until=24h",
]

DOCKER_DF_LINES = (
    "\n".join(
        [
            json.dumps(
                {
                    "ActiveCount": "8",
                    "Reclaimable": "1.5GB (71%)",
                    "Size": "3.2GB",
                    "TotalCount": "12",
                    "Type": "Images",
                }
            ),
            json.dumps(
                {
                    "ActiveCount": "3",
                    "Reclaimable": "0B (0%)",
                    "Size": "45MB",
                    "TotalCount": "5",
                    "Type": "Containers",
                }
            ),
            json.dumps(
                {
                    "ActiveCount": "2",
                    "Reclaimable": "800MB (53%)",
                    "Size": "1.5GB",
                    "TotalCount": "4",
                    "Type": "Local Volumes",
                }
            ),
            json.dumps(
                {
                    "ActiveCount": "0",
                    "Reclaimable": "2GB (100%)",
                    "Size": "2GB",
                    "TotalCount": "18",
                    "Type": "Build Cache",
                }
            ),
        ]
    )
    + "\n"
)


@pytest.fixture
def docker_client(settings):
    runner = FakeRunner()
    with TestClient(create_app(settings, runner=runner)) as client:
        yield client, runner


def test_docker_df_parses_sizes_and_percent_suffix():
    runner = FakeRunner()
    runner.on(lambda args: args == DF_ARGS, stdout=DOCKER_DF_LINES)

    result = docker_df(runner)

    assert result.images.size_bytes == 3_200_000_000
    assert result.images.reclaimable_bytes == 1_500_000_000
    assert result.images.count == 12
    assert result.containers.size_bytes == 45_000_000
    assert result.containers.reclaimable_bytes == 0
    assert result.containers.count == 5
    assert result.volumes.size_bytes == 1_500_000_000
    assert result.volumes.reclaimable_bytes == 800_000_000
    assert result.volumes.count == 4
    assert result.build_cache.size_bytes == 2_000_000_000
    assert result.build_cache.reclaimable_bytes == 2_000_000_000
    assert result.build_cache.count == 18
    assert runner.calls[0]["args"] == DF_ARGS


def test_docker_df_missing_type_is_zeros():
    runner = FakeRunner()
    runner.on(
        lambda args: args == DF_ARGS,
        stdout=json.dumps(
            {
                "Reclaimable": "0B",
                "Size": "0B",
                "TotalCount": "0",
                "Type": "Images",
            }
        )
        + "\n",
    )

    result = docker_df(runner)

    assert result.images.count == 0
    assert result.containers.size_bytes == 0
    assert result.containers.reclaimable_bytes == 0
    assert result.containers.count == 0
    assert result.volumes.size_bytes == 0
    assert result.build_cache.count == 0


def test_prune_images_parses_reclaimed_bytes():
    runner = FakeRunner()
    runner.on(
        lambda args: args == PRUNE_ARGS,
        stdout="Deleted Images:\n...\nTotal reclaimed space: 1.234GB\n",
    )

    assert prune_images(runner) == {"reclaimed_bytes": 1_234_000_000}
    assert runner.calls[0]["args"] == PRUNE_ARGS


def test_prune_images_zero_reclaimed():
    runner = FakeRunner()
    runner.on(
        lambda args: args == PRUNE_ARGS,
        stdout="Total reclaimed space: 0B\n",
    )

    assert prune_images(runner) == {"reclaimed_bytes": 0}


def test_prune_build_cache_parses_reclaimed_bytes():
    runner = FakeRunner()
    runner.on(
        lambda args: args == PRUNE_BUILD_CACHE_ARGS,
        stdout="Deleted build cache objects:\n...\nTotal reclaimed space: 1.234GB\n",
    )

    assert prune_build_cache(runner) == {"reclaimed_bytes": 1_234_000_000}
    assert runner.calls[0]["args"] == PRUNE_BUILD_CACHE_ARGS


def test_prune_build_cache_zero_reclaimed():
    runner = FakeRunner()
    runner.on(
        lambda args: args == PRUNE_BUILD_CACHE_ARGS,
        stdout="Total reclaimed space: 0B\n",
    )

    assert prune_build_cache(runner) == {"reclaimed_bytes": 0}


def test_prune_build_cache_parses_buildx_total_line():
    runner = FakeRunner()
    runner.on(
        lambda args: args == PRUNE_BUILD_CACHE_ARGS,
        stdout="ID\tRECLAIMABLE\tSIZE\tLAST ACCESSED\nabc123\ttrue\t1GB\t1 hour ago\nTotal:\t2.1GB\n",
    )

    assert prune_build_cache(runner) == {"reclaimed_bytes": int(2.1 * 1000**3)}


def test_prune_build_cache_buildx_zero_reclaimed():
    runner = FakeRunner()
    runner.on(
        lambda args: args == PRUNE_BUILD_CACHE_ARGS,
        stdout="Total:\t0B\n",
    )

    assert prune_build_cache(runner) == {"reclaimed_bytes": 0}


def test_get_docker_df_not_audited(docker_client):
    client, runner = docker_client
    runner.on(lambda args: args == DF_ARGS, stdout=DOCKER_DF_LINES)
    db = client.app.state.db
    before = len(audit.list_events(db))

    response = client.get("/v1/docker/df")

    assert response.status_code == 200
    body = response.json()
    assert body["images"]["count"] == 12
    assert len(audit.list_events(db)) == before


def test_post_prune_images_audited(docker_client):
    client, runner = docker_client
    runner.on(
        lambda args: args == PRUNE_ARGS,
        stdout="Total reclaimed space: 512MB\n",
    )
    db = client.app.state.db
    before = len(audit.list_events(db))

    response = client.post("/v1/docker/prune-images")

    assert response.status_code == 200
    assert response.json() == {"reclaimed_bytes": 512_000_000}
    assert len(audit.list_events(db)) == before + 1
    event = audit.list_events(db)[0]
    assert event.operation == "docker.prune_images"
    assert event.params == {}
    assert event.ok is True


def test_post_prune_build_cache_audited(docker_client):
    client, runner = docker_client
    runner.on(
        lambda args: args == PRUNE_BUILD_CACHE_ARGS,
        stdout="Total reclaimed space: 512MB\n",
    )
    db = client.app.state.db
    before = len(audit.list_events(db))

    response = client.post("/v1/docker/prune-build-cache")

    assert response.status_code == 200
    assert response.json() == {"reclaimed_bytes": 512_000_000}
    assert len(audit.list_events(db)) == before + 1
    event = audit.list_events(db)[0]
    assert event.operation == "docker.prune_build_cache"
    assert event.params == {}
    assert event.ok is True


def test_get_docker_df_returns_503_on_docker_failure(docker_client):
    client, runner = docker_client
    runner.on(
        lambda args: args == DF_ARGS,
        returncode=1,
        stderr="Cannot connect to the Docker daemon",
    )

    response = client.get("/v1/docker/df")

    assert response.status_code == 503
    assert "docker unavailable" in response.json()["detail"]


@pytest.mark.parametrize(
    ("method", "path", "match_args", "exc"),
    [
        ("get", "/v1/docker/df", DF_ARGS, FileNotFoundError("docker")),
        (
            "get",
            "/v1/docker/df",
            DF_ARGS,
            subprocess.TimeoutExpired(["docker", "system", "df"], 120),
        ),
        ("post", "/v1/docker/prune-images", PRUNE_ARGS, FileNotFoundError("docker")),
        (
            "post",
            "/v1/docker/prune-images",
            PRUNE_ARGS,
            subprocess.TimeoutExpired(["docker", "image", "prune"], 120),
        ),
        (
            "post",
            "/v1/docker/prune-build-cache",
            PRUNE_BUILD_CACHE_ARGS,
            FileNotFoundError("docker"),
        ),
        (
            "post",
            "/v1/docker/prune-build-cache",
            PRUNE_BUILD_CACHE_ARGS,
            subprocess.TimeoutExpired(["docker", "builder", "prune"], 120),
        ),
    ],
)
def test_docker_routes_return_503_on_missing_docker_or_timeout(
    docker_client, method, path, match_args, exc
):
    client, runner = docker_client
    runner.responses.append((lambda args: args == match_args, exc))

    response = client.request(method, path)

    assert response.status_code == 503
    assert "docker unavailable" in response.json()["detail"]


def test_post_prune_images_returns_503_on_docker_failure(docker_client):
    client, runner = docker_client
    runner.responses.append(
        (
            lambda args: args == PRUNE_ARGS,
            CommandError(CommandResult(1, "", "daemon down")),
        )
    )

    response = client.post("/v1/docker/prune-images")

    assert response.status_code == 503
    assert "docker unavailable" in response.json()["detail"]


def test_post_prune_build_cache_returns_503_on_docker_failure(docker_client):
    client, runner = docker_client
    runner.responses.append(
        (
            lambda args: args == PRUNE_BUILD_CACHE_ARGS,
            CommandError(CommandResult(1, "", "daemon down")),
        )
    )

    response = client.post("/v1/docker/prune-build-cache")

    assert response.status_code == 503
    assert "docker unavailable" in response.json()["detail"]


DOCKER_PS_LINES = "\n".join(
    [
        json.dumps(
            {
                "Names": "spliteasy-backend-1",
                "Labels": "com.docker.compose.project=spliteasy,com.docker.compose.service=backend",
                "Ports": "127.0.0.1:8000->8000/tcp, [::]:8000->8000/tcp",
            }
        ),
        json.dumps(
            {
                "Names": "vpscp-panel-1",
                "Labels": "com.docker.compose.project=vpscp",
                "Ports": "8080->8080/tcp",
            }
        ),
        json.dumps(
            {
                "Names": "postgres-central",
                "Labels": "",
                "Ports": "",
            }
        ),
        json.dumps(
            {
                "Names": "exposed-only-1",
                "Labels": "com.docker.compose.project=other,com.docker.compose.service=web",
                "Ports": "5432/tcp",
            }
        ),
    ]
)


def test_container_host_ports_parses_bindings():
    runner = FakeRunner()
    runner.on("docker ps", stdout=DOCKER_PS_LINES)

    bindings = container_host_ports(runner)

    assert bindings == [
        {
            "project": "spliteasy",
            "service": "backend",
            "container": "spliteasy-backend-1",
            "ports": [
                {"ip": "127.0.0.1", "host_port": 8000, "container_port": 8000},
                {"ip": "::", "host_port": 8000, "container_port": 8000},
            ],
        },
        {
            "project": "vpscp",
            "service": None,
            "container": "vpscp-panel-1",
            "ports": [{"ip": "", "host_port": 8080, "container_port": 8080}],
        },
    ]


def test_container_host_ports_empty_output():
    runner = FakeRunner()
    runner.on("docker ps", stdout="")

    assert container_host_ports(runner) == []


def test_container_host_ports_falls_back_to_network_settings():
    runner = FakeRunner()
    runner.on(
        "docker ps",
        stdout=json.dumps(
            {
                "Names": "spliteasy-backend-1",
                "Labels": {
                    "com.docker.compose.project": "spliteasy",
                    "com.docker.compose.service": "backend",
                },
                "NetworkSettings": {
                    "Ports": {
                        "8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8000"}],
                        "9100/tcp": None,
                    }
                },
            }
        ),
    )

    bindings = container_host_ports(runner)

    assert bindings == [
        {
            "project": "spliteasy",
            "service": "backend",
            "container": "spliteasy-backend-1",
            "ports": [{"ip": "127.0.0.1", "host_port": 8000, "container_port": 8000}],
        }
    ]
