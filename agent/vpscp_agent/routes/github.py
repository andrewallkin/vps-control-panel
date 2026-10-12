from __future__ import annotations

from fastapi import APIRouter, Request

from vpscp_agent import audit
from vpscp_agent.github_keys import ensure_known_hosts

router = APIRouter(tags=["github"])


@router.post("/v1/github/refresh-known-hosts")
def post_refresh_known_hosts(request: Request) -> dict[str, str]:
    db = request.app.state.db
    settings = request.app.state.settings
    with audit.audited(db, "github.refresh_known_hosts", {}):
        ensure_known_hosts(settings, force=True)
    return {"status": "ok"}
