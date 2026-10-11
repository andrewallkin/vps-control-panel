import json
from collections.abc import AsyncIterator
from typing import Any

import httpx


class AgentError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        self.detail = detail
        super().__init__(detail)


def _detail_from_response(response: httpx.Response) -> str:
    text = response.text
    try:
        body = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(body, dict) and "detail" in body:
        return str(body["detail"])
    return text


class AgentClient:
    def __init__(
        self,
        socket_path: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if transport is None:
            transport = httpx.AsyncHTTPTransport(uds=socket_path)
        self._client = httpx.AsyncClient(
            transport=transport,
            base_url="http://agent",
            timeout=httpx.Timeout(30.0),
        )

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            response = await self._client.get(path, params=params)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc
        if response.is_error:
            raise AgentError(response.status_code, _detail_from_response(response))
        return response.json()

    async def post(self, path: str, json: dict[str, Any] | None = None) -> Any:
        try:
            response = await self._client.post(path, json=json)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc
        if response.is_error:
            raise AgentError(response.status_code, _detail_from_response(response))
        return response.json()

    async def delete(
        self,
        path: str,
        json: dict[str, Any] | None = None,
    ) -> None:
        try:
            if json is None:
                response = await self._client.delete(path)
            else:
                response = await self._client.request("DELETE", path, json=json)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc
        if response.is_error:
            raise AgentError(response.status_code, _detail_from_response(response))

    async def patch(self, path: str, json: dict[str, Any] | None = None) -> Any:
        try:
            response = await self._client.patch(path, json=json)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc
        if response.is_error:
            raise AgentError(response.status_code, _detail_from_response(response))
        return response.json()

    async def put(self, path: str, json: dict[str, Any] | None = None) -> Any:
        try:
            response = await self._client.put(path, json=json)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc
        if response.is_error:
            raise AgentError(response.status_code, _detail_from_response(response))
        return response.json()

    async def put_bytes(
        self,
        path: str,
        data: bytes,
        params: dict[str, Any] | None = None,
    ) -> Any:
        try:
            response = await self._client.put(path, content=data, params=params)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc
        if response.is_error:
            raise AgentError(response.status_code, _detail_from_response(response))
        return response.json()

    async def stream(self, path: str) -> AsyncIterator[bytes]:
        try:
            async with self._client.stream(
                "GET",
                path,
                timeout=httpx.Timeout(30.0, read=None),
            ) as response:
                if response.is_error:
                    await response.aread()
                    raise AgentError(response.status_code, _detail_from_response(response))
                async for chunk in response.aiter_bytes():
                    yield chunk
        except AgentError:
            raise
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise AgentError(503, "agent unavailable") from exc

    async def aclose(self) -> None:
        await self._client.aclose()
