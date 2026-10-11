from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from vpscp_agent import tls
from vpscp_agent.validation import DomainName

router = APIRouter(tags=["tls"])


class TlsIssueBody(BaseModel):
    domain: DomainName


def _get_setting(db, key: str) -> str | None:
    with db.connect() as conn:
        row = conn.execute("SELECT value FROM agent_setting WHERE key = ?", (key,)).fetchone()
    return None if row is None else row["value"]


@router.get("/v1/tls/status")
def get_tls_status(request: Request) -> list[dict]:
    settings = request.app.state.settings
    db = request.app.state.db
    return tls.status(settings, db)


@router.post("/v1/tls/issue", status_code=202)
def post_tls_issue(body: TlsIssueBody, request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    db = request.app.state.db
    runner = request.app.state.runner
    jobs = request.app.state.jobs
    email = _get_setting(db, "acme_email")
    tls.require_issue_preconditions(settings, db, body.domain, email)

    def body_fn(ctx):
        tls.issue(ctx, settings=settings, runner=runner, domain=body.domain, email=email)

    job = jobs.start(
        "tls.issue",
        {"domain": body.domain},
        body_fn,
        lock_key="certbot",
    )
    return {"job_id": job.id}


@router.post("/v1/tls/renew", status_code=202)
def post_tls_renew(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    runner = request.app.state.runner
    jobs = request.app.state.jobs

    def body_fn(ctx):
        tls.renew_all(ctx, settings=settings, runner=runner)

    job = jobs.start(
        "tls.renew",
        {},
        body_fn,
        lock_key="certbot",
    )
    return {"job_id": job.id}
