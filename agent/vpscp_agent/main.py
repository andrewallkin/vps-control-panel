import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, Query

from vpscp_agent import __version__, audit, metrics
from vpscp_agent.config import Settings
from vpscp_agent.state import StateDB


def create_app(settings: Settings) -> FastAPI:
    db = StateDB(settings.state_db_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        db.migrate()
        stop = asyncio.Event()
        sampler = asyncio.create_task(
            metrics.run_sampler(
                db,
                settings.disk_paths,
                settings.metrics_interval_seconds,
                settings.metrics_retention_days,
                stop,
            )
        )
        try:
            yield
        finally:
            stop.set()
            await sampler

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

    @app.get("/v1/metrics/current")
    def metrics_current() -> metrics.HostMetrics:
        return metrics.collect_host(settings.disk_paths)

    @app.get("/v1/metrics/history")
    def metrics_history(hours: int = Query(24, ge=1, le=168)) -> list[metrics.MetricPoint]:
        return metrics.history(db, since=datetime.now(UTC) - timedelta(hours=hours))

    return app
