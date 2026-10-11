SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
    "content-security-policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ),
    "x-robots-tag": "noindex",
}


def _assert_security_headers(response) -> None:
    for header, value in SECURITY_HEADERS.items():
        assert response.headers.get(header) == value


def test_security_headers_on_health(client):
    _assert_security_headers(client.get("/api/health"))


def test_security_headers_on_spa_response(client):
    _assert_security_headers(client.get("/"))
