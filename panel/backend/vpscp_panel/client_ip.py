from fastapi import Request


def client_ip(request: Request) -> str:
    """The admin's source IP as seen by our nginx.

    Only X-Real-IP counts: nginx sets it from $remote_addr (the TCP peer —
    the Cloudflare edge or a direct client). CF-Connecting-IP is
    caller-controlled and forwarded by nginx, so trusting it would let
    anyone spoof the firewall guardrails' and audit trail's idea of the
    client. When nginx is bypassed there is no trustworthy forwarding
    header at all.
    """
    value = request.headers.get("X-Real-IP")
    if value:
        return value.split(",")[0].strip()
    client = request.client
    return client.host if client is not None else ""
