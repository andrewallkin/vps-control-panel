import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

import vpscp_panel.db as db_module
from vpscp_panel import __version__
from vpscp_panel.agent_client import AgentClient, AgentError
from vpscp_panel.auth import current_session
from vpscp_panel.auth import router as auth_router
from vpscp_panel.config import PanelSettings
from vpscp_panel.db import init_db, run_migrations
from vpscp_panel.deploy_ops import reconcile_deploy_jobs, reconcile_stuck_work
from vpscp_panel.models import Session
from vpscp_panel.routes.account_api import router as account_api_router
from vpscp_panel.routes.audit import router as audit_router
from vpscp_panel.routes.backups_api import router as backups_api_router
from vpscp_panel.routes.dashboard import router as dashboard_router
from vpscp_panel.routes.database_api import router as database_api_router
from vpscp_panel.routes.deploys_api import router as deploys_api_router
from vpscp_panel.routes.domains_api import router as domains_api_router
from vpscp_panel.routes.firewall import router as firewall_router
from vpscp_panel.routes.jobs import router as jobs_router
from vpscp_panel.routes.metrics import router as metrics_router
from vpscp_panel.routes.projects_api import router as projects_api_router
from vpscp_panel.routes.projects_api import utility_router as projects_utility_router
from vpscp_panel.routes.settings_api import router as settings_api_router
from vpscp_panel.routes.setup import router as setup_router

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; img-src 'self' data:; font-src 'self' data:; "
    "style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        response.headers["X-Robots-Tag"] = "noindex"
        return response


def _resolve_static_file(static_root: Path, request_path: str) -> Path | None:
    relative = request_path.lstrip("/")
    if relative == "":
        relative = "index.html"
    candidate = (static_root / relative).resolve()
    try:
        candidate.relative_to(static_root.resolve())
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


def create_app(settings: PanelSettings | None = None, agent: AgentClient | None = None) -> FastAPI:
    resolved_settings = settings if settings is not None else PanelSettings()
    owns_agent = agent is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        run_migrations(resolved_settings)
        init_db(resolved_settings)
        if app.state.agent is None:
            app.state.agent = AgentClient(str(resolved_settings.agent_socket))
        if db_module.SessionLocal is not None:
            with db_module.SessionLocal() as session:
                reconcile_stuck_work(session, app.state.clock)
            await reconcile_deploy_jobs(db_module.SessionLocal, app.state.agent, app.state.clock)
        try:
            yield
        finally:
            if owns_agent and app.state.agent is not None:
                await app.state.agent.aclose()

    app = FastAPI(lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.agent = agent
    app.state.clock = lambda: datetime.now(UTC)
    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(AgentError)
    async def handle_agent_error(_request: Request, exc: AgentError) -> JSONResponse:
        status = exc.status if exc.status in (400, 404, 409, 422) else 502
        return JSONResponse(status_code=status, content={"detail": exc.detail})

    static_root = resolved_settings.panel_static_dir.resolve()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/health/agent")
    async def agent_health(
        request: Request,
        _session: Annotated[Session, Depends(current_session)],
    ) -> dict[str, Any]:
        payload = await request.app.state.agent.get("/v1/health")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=502, detail="invalid agent health response")
        status = payload.get("status")
        version = payload.get("version")
        if not isinstance(status, str) or not isinstance(version, str):
            raise HTTPException(status_code=502, detail="invalid agent health response")
        return {"status": status, "version": version}

    app.include_router(auth_router)
    app.include_router(metrics_router)
    app.include_router(jobs_router)
    app.include_router(dashboard_router)
    app.include_router(audit_router)
    app.include_router(firewall_router)
    app.include_router(backups_api_router)
    app.include_router(database_api_router)
    app.include_router(account_api_router)
    app.include_router(settings_api_router)
    app.include_router(setup_router)
    app.include_router(domains_api_router)
    app.include_router(projects_api_router)
    app.include_router(projects_utility_router)
    app.include_router(deploys_api_router)

    @app.get("/api")
    @app.get("/api/")
    async def api_root() -> None:
        raise HTTPException(status_code=404, detail="Not Found")

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    )
    async def unknown_api(path: str) -> None:
        raise HTTPException(status_code=404, detail="Not Found")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = _resolve_static_file(static_root, full_path)
        if file_path is not None:
            return FileResponse(file_path)
        index_path = static_root / "index.html"
        if index_path.is_file():
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Not Found")

    return app


if os.environ.get("PANEL_SECRET_KEY"):
    app = create_app()
else:
    app = None
