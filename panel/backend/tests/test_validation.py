import pytest

from vpscp_panel.validation import validate_route_path


@pytest.mark.parametrize(
    "value",
    [
        "/",
        "/api/",
        "/mcp/",
        "/messages/",
        "/v1/my_path-x",
        "/.well-known",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource",
    ],
)
def test_route_path_accepts(value):
    assert validate_route_path(value) == value


@pytest.mark.parametrize(
    "value",
    ["", "api", "/a/../b", "/..", "/a b", "/a;b", "/a{b}", "/foo..bar"],
)
def test_route_path_rejects(value):
    with pytest.raises(ValueError):
        validate_route_path(value)
