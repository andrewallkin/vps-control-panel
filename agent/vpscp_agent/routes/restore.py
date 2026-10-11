from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field

from vpscp_agent import audit
from vpscp_agent.restore import UploadInfo, UploadStore, restore_cluster

router = APIRouter(prefix="/v1/restore", tags=["restore"])


class CreateUploadBody(BaseModel):
    filename: str
    size: int = Field(ge=0)


class CompleteUploadBody(BaseModel):
    sha256: str = Field(min_length=64, max_length=64)


class RestoreRunBody(BaseModel):
    upload_id: str
    confirm: str


def _store(request: Request) -> UploadStore:
    return UploadStore(request.app.state.settings)


@router.post("/uploads")
def create_upload(body: CreateUploadBody, request: Request) -> dict[str, str]:
    db = request.app.state.db
    params = {"filename": body.filename, "size": body.size}
    with audit.audited(db, "restore.create_upload", params):
        upload_id = _store(request).create(body.filename, body.size)
    return {"upload_id": upload_id}


@router.put("/uploads/{upload_id}")
async def append_upload(
    upload_id: str,
    request: Request,
    offset: int = Query(..., ge=0),
) -> dict[str, int]:
    chunk = await request.body()
    db = request.app.state.db
    params = {"upload_id": upload_id, "offset": offset, "bytes": len(chunk)}
    with audit.audited(db, "restore.append", params):
        received = _store(request).append(upload_id, offset, chunk)
    return {"received": received}


@router.post("/uploads/{upload_id}/complete")
def complete_upload(upload_id: str, body: CompleteUploadBody, request: Request) -> UploadInfo:
    db = request.app.state.db
    params = {"upload_id": upload_id}
    with audit.audited(db, "restore.complete", params):
        info = _store(request).complete(upload_id, body.sha256)
    return info


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: str, request: Request) -> dict[str, object]:
    meta = _store(request).get(upload_id)
    return {
        "id": upload_id,
        "filename": meta.filename,
        "size": meta.size,
        "received": meta.received,
        "created_at": meta.created_at,
    }


@router.post("/run", status_code=202)
def run_restore(body: RestoreRunBody, request: Request) -> dict[str, str]:
    if body.confirm != "RESTORE":
        raise ValueError("confirm must be RESTORE")
    settings = request.app.state.settings
    psql = request.app.state.psql
    runner = request.app.state.runner
    db = request.app.state.db
    jobs = request.app.state.jobs

    def body_fn(ctx):
        return restore_cluster(
            ctx,
            settings=settings,
            psql=psql,
            runner=runner,
            db=db,
            upload_id=body.upload_id,
        )

    job = jobs.start(
        "db.restore_cluster",
        {"upload_id": body.upload_id},
        body_fn,
        lock_key="postgres",
    )
    return {"job_id": job.id}


@router.delete("/uploads/{upload_id}", status_code=204)
def delete_upload(upload_id: str, request: Request) -> Response:
    db = request.app.state.db
    params = {"upload_id": upload_id}
    with audit.audited(db, "restore.delete", params):
        _store(request).delete(upload_id)
    return Response(status_code=204)
