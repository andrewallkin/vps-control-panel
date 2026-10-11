from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

from vpscp_panel import __version__
from vpscp_panel.config import PanelSettings
from vpscp_panel.db import init_db, run_migrations

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
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


def create_app(settings: PanelSettings | None = None, agent: Any = None) -> FastAPI:
    resolved_settings = settings if settings is not None else PanelSettings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        run_migrations(resolved_settings)
        init_db(resolved_settings)
        yield

    app = FastAPI(lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.agent = agent
    app.add_middleware(SecurityHeadersMiddleware)

    static_root = resolved_settings.panel_static_dir.resolve()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

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
