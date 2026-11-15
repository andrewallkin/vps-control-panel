from __future__ import annotations

from typing import Any, Literal

RuntimeStatus = Literal["running", "degraded", "stopped", "not_deployed"]


def compose_services_from_ps(ps: Any) -> list[dict[str, Any]] | None:
    if not isinstance(ps, dict):
        return None
    services = ps.get("services")
    if not isinstance(services, list):
        return None
    return [row for row in services if isinstance(row, dict)]


def classify_compose_ps(ps: Any) -> Literal["up", "unhealthy", "empty"]:
    if not isinstance(ps, dict):
        return "unhealthy"
    services = ps.get("services")
    if not isinstance(services, list):
        return "unhealthy"
    if not services:
        return "empty"
    for svc in services:
        if not isinstance(svc, dict):
            return "unhealthy"
        if svc.get("state") != "running":
            return "unhealthy"
        if svc.get("health") == "unhealthy":
            return "unhealthy"
    return "up"


def runtime_status_from_ps(ps: Any, *, has_deploy: bool) -> RuntimeStatus:
    if not has_deploy:
        return "not_deployed"
    services = compose_services_from_ps(ps)
    if services is None:
        return "degraded"
    if not services:
        return "stopped"
    any_running = any(svc.get("state") == "running" for svc in services)
    if not any_running:
        return "stopped"
    for svc in services:
        if svc.get("state") != "running" or svc.get("health") == "unhealthy":
            return "degraded"
    return "running"
