from fastapi import FastAPI

from vpscp_agent import __version__
from vpscp_agent.config import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="vpscp-agent",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings

    @app.get("/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
