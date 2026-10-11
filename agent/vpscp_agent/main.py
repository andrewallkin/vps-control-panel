from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query

from vpscp_agent import __version__, audit
from vpscp_agent.config import Settings
from vpscp_agent.state import StateDB


def create_app(settings: Settings) -> FastAPI:
    db = StateDB(settings.state_db_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        db.migrate()
        yield

    app = FastAPI(
        title="vpscp-agent",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.db = db

    @app.get("/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/v1/audit")
    def list_audit(
        limit: int = Query(100, ge=1, le=500),
        before_id: int | None = Query(None, ge=1),
    ) -> list[audit.AuditEvent]:
        return audit.list_events(db, limit=limit, before_id=before_id)

    return app
