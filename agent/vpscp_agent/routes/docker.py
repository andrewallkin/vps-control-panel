import json
import subprocess

from fastapi import APIRouter, HTTPException, Request

from vpscp_agent import audit
from vpscp_agent.commands import CommandError
from vpscp_agent.docker_ops import (
    DockerDiskUsage,
    docker_df,
    prune_build_cache,
    prune_images,
)

router = APIRouter(prefix="/v1/docker", tags=["docker"])


def _docker_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"docker unavailable: {exc}")


@router.get("/df")
def get_docker_df(request: Request) -> DockerDiskUsage:
    runner = request.app.state.runner
    try:
        return docker_df(runner)
    except (
        CommandError,
        FileNotFoundError,
        subprocess.TimeoutExpired,
        json.JSONDecodeError,
        ValueError,
        KeyError,
    ) as exc:
        raise _docker_unavailable(exc) from exc


@router.post("/prune-images")
def post_prune_images(request: Request) -> dict[str, int]:
    runner = request.app.state.runner
    db = request.app.state.db
    with audit.audited(db, "docker.prune_images", {}):
        try:
            return prune_images(runner)
        except (
            CommandError,
            FileNotFoundError,
            subprocess.TimeoutExpired,
            json.JSONDecodeError,
            ValueError,
            KeyError,
        ) as exc:
            raise _docker_unavailable(exc) from exc


@router.post("/prune-build-cache")
def post_prune_build_cache(request: Request) -> dict[str, int]:
    runner = request.app.state.runner
    db = request.app.state.db
    with audit.audited(db, "docker.prune_build_cache", {}):
        try:
            return prune_build_cache(runner)
        except (
            CommandError,
            FileNotFoundError,
            subprocess.TimeoutExpired,
            json.JSONDecodeError,
            ValueError,
            KeyError,
        ) as exc:
            raise _docker_unavailable(exc) from exc
