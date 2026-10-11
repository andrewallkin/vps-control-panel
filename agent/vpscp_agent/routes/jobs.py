import asyncio
import json
import time

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.responses import StreamingResponse

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


@router.get("")
def list_jobs(request: Request) -> list[dict]:
    mgr = request.app.state.jobs
    out: list[dict] = []
    for job in mgr.list():
        snap = job.snapshot()
        lines = snap.pop("lines")
        snap["lines_count"] = len(lines)
        out.append(snap)
    return out


@router.get("/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    mgr = request.app.state.jobs
    job = mgr.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job.snapshot()


@router.get("/{job_id}/events")
async def job_events(
    job_id: str,
    request: Request,
    since: int = Query(0, ge=0),
) -> StreamingResponse:
    mgr = request.app.state.jobs
    job = mgr.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")

    async def stream():
        next_line = since
        last_activity = time.monotonic()
        while True:
            with job._lines_lock:
                total = len(job.lines)
                while next_line < total:
                    text = job.lines[next_line]
                    payload = json.dumps({"n": next_line, "text": text})
                    yield f"event: line\ndata: {payload}\n\n"
                    next_line += 1
                    last_activity = time.monotonic()

            if job.status != "running" and next_line >= total:
                end_payload = json.dumps(
                    {
                        "status": job.status,
                        "result": job.result,
                        "error": job.error,
                    }
                )
                yield f"event: end\ndata: {end_payload}\n\n"
                return

            now = time.monotonic()
            if now - last_activity >= 15:
                yield ": keepalive\n\n"
                last_activity = now

            await asyncio.sleep(0.25)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
