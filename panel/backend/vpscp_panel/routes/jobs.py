from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import StreamingResponse

from vpscp_panel.agent_client import AgentClient
from vpscp_panel.auth import current_session
from vpscp_panel.models import Session

router = APIRouter(tags=["jobs"])


def _agent(request: Request) -> AgentClient:
    return request.app.state.agent


@router.get("/api/jobs/{job_id}")
async def get_job(
    job_id: str,
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> dict:
    return await agent.get(f"/v1/jobs/{job_id}")


async def _relay_sse(agent: AgentClient, path: str) -> AsyncIterator[bytes]:
    async for chunk in agent.stream(path):
        yield chunk


@router.get("/api/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    _session: Annotated[Session, Depends(current_session)],
    agent: Annotated[AgentClient, Depends(_agent)],
) -> StreamingResponse:
    return StreamingResponse(
        _relay_sse(agent, f"/v1/jobs/{job_id}/events"),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},
    )
