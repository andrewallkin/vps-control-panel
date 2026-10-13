from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session, require_csrf
from vpscp_panel.models import Session

router = APIRouter(tags=["metrics"])


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


@router.get("/api/metrics/current")
async def metrics_current(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict:
    return await agent.get("/v1/metrics/current")


@router.get("/api/metrics/history", response_model=None)
async def metrics_history(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
    hours: str | None = None,
) -> Any:
    params = {"hours": hours} if hours is not None else None
    return await agent.get("/v1/metrics/history", params=params)


@router.get("/api/metrics/containers", response_model=None)
async def metrics_containers(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> Any:
    return await agent.get("/v1/metrics/containers")


@router.get("/api/docker/df")
async def docker_df(
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict:
    return await agent.get("/v1/docker/df")


@router.post("/api/docker/prune-images")
async def docker_prune_images(
    _session: Annotated[Session, Depends(require_csrf)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict:
    return await agent.post("/v1/docker/prune-images")


@router.post("/api/docker/prune-build-cache")
async def docker_prune_build_cache(
    _session: Annotated[Session, Depends(require_csrf)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict:
    return await agent.post("/v1/docker/prune-build-cache")
