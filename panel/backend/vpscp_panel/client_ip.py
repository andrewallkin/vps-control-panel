from fastapi import Request


def client_ip(request: Request) -> str:
    for header in ("CF-Connecting-IP", "X-Real-IP"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    client = request.client
    return client.host if client is not None else ""
