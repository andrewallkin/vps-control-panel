import asyncio
import json
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from vpscp_agent import __version__, audit, container_metrics, metrics
from vpscp_agent.cloudflare import CloudflareError
from vpscp_agent.commands import CommandError, run_command
from vpscp_agent.config import Settings
from vpscp_agent.db_ops import ConflictError, NotFoundError
from vpscp_agent.jobs import JobLockedError, JobManager
from vpscp_agent.nginx_apply import NginxTestError
from vpscp_agent.pg import Psql
from vpscp_agent.registry import DockerHubLoginError
from vpscp_agent.routes import backup as backup_routes
from vpscp_agent.routes import compose as compose_routes
from vpscp_agent.routes import database as database_routes
from vpscp_agent.routes import deploy as deploy_routes
from vpscp_agent.routes import dns as dns_routes
from vpscp_agent.routes import docker as docker_routes
from vpscp_agent.routes import firewall as firewall_routes
from vpscp_agent.routes import github as github_routes
from vpscp_agent.routes import jobs as jobs_routes
from vpscp_agent.routes import nginx as nginx_routes
from vpscp_agent.routes import projects as projects_routes
from vpscp_agent.routes import registry as registry_routes
from vpscp_agent.routes import restore as restore_routes
from vpscp_agent.routes import server as server_routes
from vpscp_agent.routes import tls as tls_routes
from vpscp_agent.state import StateDB


def create_app(settings: Settings, runner=run_command) -> FastAPI:
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
    app.state.runner = runner
    app.state.psql = Psql(settings, runner)
    app.state.jobs = JobManager(db)

    @app.exception_handler(JobLockedError)
    async def job_locked_handler(_request, _exc: JobLockedError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": "job lock held"})

    @app.exception_handler(ConflictError)
    async def conflict_handler(_request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(NotFoundError)
    async def not_found_handler(_request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(CommandError)
    async def command_error_handler(_request: Request, exc: CommandError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(CloudflareError)
    async def cloudflare_error_handler(_request: Request, exc: CloudflareError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(DockerHubLoginError)
    async def dockerhub_login_error_handler(
        _request: Request, _exc: DockerHubLoginError
    ) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": "Docker Hub login failed"})

    @app.exception_handler(NginxTestError)
    async def nginx_test_error_handler(_request: Request, exc: NginxTestError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": exc.output})

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
        if request.url.path.startswith(
            (
                "/v1/db",
                "/v1/restore",
                "/v1/backup",
                "/v1/domains",
                "/v1/server",
                "/v1/dns",
                "/v1/tls",
                "/v1/nginx",
                "/v1/projects",
                "/v1/registry",
                "/v1/firewall",
                "/v1/github",
            )
        ):
            return JSONResponse(status_code=400, content={"detail": str(exc)})
        raise exc

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        status = (
            400
            if request.url.path.startswith(("/v1/db", "/v1/restore", "/v1/backup", "/v1/firewall"))
            else 422
        )
        return JSONResponse(status_code=status, content={"detail": jsonable_encoder(exc.errors())})

    app.include_router(jobs_routes.router)
    app.include_router(database_routes.router)
    app.include_router(restore_routes.router)
    app.include_router(backup_routes.router)
    app.include_router(docker_routes.router)
    app.include_router(server_routes.router)
    app.include_router(dns_routes.router)
    app.include_router(tls_routes.router)
    app.include_router(nginx_routes.router)
    app.include_router(projects_routes.router)
    app.include_router(compose_routes.router)
    app.include_router(deploy_routes.router)
    app.include_router(registry_routes.router)
    app.include_router(firewall_routes.router)
    app.include_router(github_routes.router)

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

    @app.get("/v1/metrics/containers")
    def metrics_containers() -> list[container_metrics.ContainerMetrics]:
        try:
            return container_metrics.collect_containers()
        except (
            FileNotFoundError,
            subprocess.CalledProcessError,
            subprocess.TimeoutExpired,
            json.JSONDecodeError,
            ValueError,
            KeyError,
        ) as exc:
            raise HTTPException(status_code=503, detail=f"docker unavailable: {exc}") from exc

    return app
