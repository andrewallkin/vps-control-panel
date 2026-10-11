from __future__ import annotations

import re
import time
from collections.abc import Callable
from typing import Any

import httpx

from vpscp_agent.commands import Runner
from vpscp_agent.config import Settings
from vpscp_agent.credentials import read_dockerhub_credentials, write_dockerhub_json
from vpscp_agent.validation import validate_branch

JWT_CACHE_SECONDS = 300
_HUB_LOGIN_URL = "https://hub.docker.com/v2/users/login"
_PART_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


class DockerHubLoginError(Exception):
    def __init__(self) -> None:
        super().__init__("Docker Hub login failed")


def validate_registry_username(value: str) -> str:
    if len(value) > 200:
        raise ValueError("username too long")
    if not _USERNAME_RE.fullmatch(value):
        raise ValueError(f"invalid username: {value!r}")
    return value


def validate_registry_token(value: str) -> str:
    if not value or len(value) > 200:
        raise ValueError("invalid token")
    return value


def parse_registry_repo(value: str) -> tuple[str, str]:
    if "/" not in value:
        raise ValueError(f"invalid repo: {value!r}")
    namespace, name = value.split("/", 1)
    if not namespace or not name or "/" in name:
        raise ValueError(f"invalid repo: {value!r}")
    if not _PART_RE.fullmatch(namespace) or not _PART_RE.fullmatch(name):
        raise ValueError(f"invalid repo: {value!r}")
    return namespace, name


def validate_tag_prefix(value: str) -> str:
    if not _PART_RE.fullmatch(value):
        raise ValueError(f"invalid prefix: {value!r}")
    return value


def _now_for_app(app: Any) -> Callable[[], float]:
    return getattr(app.state, "dockerhub_now", time.monotonic)


def _transport_for_app(app: Any) -> httpx.BaseTransport | None:
    return getattr(app.state, "dockerhub_transport", None)


def _cached_jwt(app: Any) -> str | None:
    jwt = getattr(app.state, "dockerhub_jwt", None)
    cached_at = getattr(app.state, "dockerhub_jwt_at", None)
    if not isinstance(jwt, str) or not jwt:
        return None
    if not isinstance(cached_at, (int, float)):
        return None
    if _now_for_app(app)() - float(cached_at) > JWT_CACHE_SECONDS:
        return None
    return jwt


def _store_jwt(app: Any, jwt: str) -> None:
    app.state.dockerhub_jwt = jwt
    app.state.dockerhub_jwt_at = _now_for_app(app)()


def hub_login(
    username: str,
    password: str,
    *,
    transport: httpx.BaseTransport | None = None,
) -> str:
    with httpx.Client(transport=transport) as client:
        response = client.post(
            _HUB_LOGIN_URL,
            json={"username": username, "password": password},
        )
    if not (200 <= response.status_code < 300):
        raise DockerHubLoginError()
    try:
        body = response.json()
    except ValueError as exc:
        raise DockerHubLoginError() from exc
    if not isinstance(body, dict):
        raise DockerHubLoginError()
    token = body.get("token")
    if not isinstance(token, str) or not token:
        raise DockerHubLoginError()
    return token


def docker_login(username: str, token: str, runner: Runner) -> None:
    runner(
        ["docker", "login", "-u", username, "--password-stdin"],
        input_data=token,
    )


def set_credentials(
    settings: Settings,
    runner: Runner,
    username: str,
    token: str,
    *,
    app: Any,
) -> None:
    validate_registry_username(username)
    validate_registry_token(token)
    transport = _transport_for_app(app)
    jwt = hub_login(username, token, transport=transport)
    docker_login(username, token, runner)
    write_dockerhub_json(settings, username, token)
    _store_jwt(app, jwt)


def registry_status(settings: Settings) -> dict[str, object]:
    creds = read_dockerhub_credentials(settings)
    if creds is None:
        return {"configured": False}
    username, _token = creds
    return {"configured": True, "username": username}


def _tag_digest(tag: dict[str, Any]) -> str | None:
    digest = tag.get("digest")
    if isinstance(digest, str) and digest:
        return digest
    images = tag.get("images")
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, dict):
            image_digest = first.get("digest")
            if isinstance(image_digest, str) and image_digest:
                return image_digest
    return None


def _tag_pushed_at(tag: dict[str, Any]) -> str | None:
    last_pushed = tag.get("last_pushed")
    if isinstance(last_pushed, str) and last_pushed:
        return last_pushed
    last_updated = tag.get("last_updated")
    if isinstance(last_updated, str):
        return last_updated
    return None


def _parse_tag_page(
    tags: list[dict[str, Any]],
    *,
    prefix: str,
    sanitized_branch: str,
) -> list[dict[str, object]]:
    pattern = re.compile(rf"^{re.escape(prefix)}-{re.escape(sanitized_branch)}-([0-9a-f]{{7,40}})$")
    out: list[dict[str, object]] = []
    for tag in tags:
        if not isinstance(tag, dict):
            continue
        name = tag.get("name")
        if not isinstance(name, str):
            continue
        match = pattern.fullmatch(name)
        if not match:
            continue
        out.append(
            {
                "name": name,
                "sha": match.group(1),
                "pushed_at": _tag_pushed_at(tag),
                "digest": _tag_digest(tag),
            }
        )
    return out


def list_registry_tags(
    settings: Settings,
    *,
    repo: str,
    prefix: str,
    branch: str,
    app: Any,
) -> list[dict[str, object]]:
    if read_dockerhub_credentials(settings) is None:
        raise ValueError("Docker Hub credentials are not configured")

    namespace, name = parse_registry_repo(repo)
    validate_tag_prefix(prefix)
    validated_branch = validate_branch(branch)
    sanitized_branch = validated_branch.replace("/", "-")

    transport = _transport_for_app(app)
    jwt = _cached_jwt(app)
    if jwt is None:
        creds = read_dockerhub_credentials(settings)
        assert creds is not None
        username, password = creds
        jwt = hub_login(username, password, transport=transport)
        _store_jwt(app, jwt)

    name_filter = f"{prefix}-{sanitized_branch}-"
    url = (
        f"https://hub.docker.com/v2/namespaces/{namespace}/repositories/{name}/tags"
        f"?page_size=100&ordering=last_updated&name={name_filter}"
    )
    headers = {"Authorization": f"JWT {jwt}"}
    matched: list[dict[str, object]] = []
    pages = 0

    with httpx.Client(transport=transport) as client:
        while url and pages < 3:
            response = client.get(url, headers=headers)
            if not (200 <= response.status_code < 300):
                raise DockerHubLoginError()
            try:
                body = response.json()
            except ValueError as exc:
                raise DockerHubLoginError() from exc
            if not isinstance(body, dict):
                raise DockerHubLoginError()
            results = body.get("results")
            if isinstance(results, list):
                matched.extend(
                    _parse_tag_page(
                        results,
                        prefix=prefix,
                        sanitized_branch=sanitized_branch,
                    )
                )
            url = body.get("next") if isinstance(body.get("next"), str) else None
            pages += 1

    return matched
