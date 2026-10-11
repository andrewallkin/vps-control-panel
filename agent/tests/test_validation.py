from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from vpscp_agent.validation import (
    DomainName,
    Port,
    Slug,
    safe_project_path,
    validate_domain,
    validate_env_key,
    validate_env_value,
    validate_port,
    validate_route_path,
    validate_slug,
    validate_sql_ident,
    validate_subdomain,
)


@pytest.mark.parametrize("value", ["budgethq", "health-tracker", "a1", "strava-automation-service"])
def test_slug_accepts(value):
    assert validate_slug(value) == value


@pytest.mark.parametrize(
    "value", ["", "a", "1abc", "Budget", "budget_hq", "budget hq", "../etc", "a" * 40]
)
def test_slug_rejects(value):
    with pytest.raises(ValueError):
        validate_slug(value)


@pytest.mark.parametrize("value", ["", "api", "www", "my-app", "a", "x" * 63])
def test_subdomain_accepts(value):
    assert validate_subdomain(value) == value


@pytest.mark.parametrize("value", ["-api", "api-", "a.b", "API", "x" * 64, "my_app", "*"])
def test_subdomain_rejects(value):
    with pytest.raises(ValueError):
        validate_subdomain(value)


@pytest.mark.parametrize("value", ["andrewallkin.cloud", "pteriandkodi.co.za", "example.com"])
def test_domain_accepts(value):
    assert validate_domain(value) == value


@pytest.mark.parametrize(
    "value", ["", "localhost", "Example.com", "exa mple.com", "-a.com", "a..com"]
)
def test_domain_rejects(value):
    with pytest.raises(ValueError):
        validate_domain(value)


@pytest.mark.parametrize("value", [1024, 3000, 10000, 65535])
def test_port_accepts(value):
    assert validate_port(value) == value


@pytest.mark.parametrize("value", [0, 80, 1023, 5432, 8080, 65536])
def test_port_rejects(value):
    with pytest.raises(ValueError):
        validate_port(value)


@pytest.mark.parametrize("value", ["POSTGRES_HOST", "_X", "A1"])
def test_env_key_accepts(value):
    assert validate_env_key(value) == value


@pytest.mark.parametrize("value", ["", "lower", "1ABC", "A-B", "A B"])
def test_env_key_rejects(value):
    with pytest.raises(ValueError):
        validate_env_key(value)


def test_env_value_accepts_symbols_and_spaces():
    value = 'p@ss w0rd!$"=#'
    assert validate_env_value(value) == value


@pytest.mark.parametrize("value", ["a\nb", "a\rb", "a\x00b"])
def test_env_value_rejects_control_characters(value):
    with pytest.raises(ValueError):
        validate_env_value(value)


@pytest.mark.parametrize("value", ["budgethq", "strava_automation", "budgethq_user"])
def test_sql_ident_accepts(value):
    assert validate_sql_ident(value) == value


@pytest.mark.parametrize("value", ["", "a", "Budget", "1db", "db-name", 'db"; DROP', "a" * 64])
def test_sql_ident_rejects(value):
    with pytest.raises(ValueError):
        validate_sql_ident(value)


@pytest.mark.parametrize("value", ["/", "/api/", "/mcp/", "/messages/", "/v1/my_path-x"])
def test_route_path_accepts(value):
    assert validate_route_path(value) == value


@pytest.mark.parametrize("value", ["", "api", "/a/../b", "/a b", "/a;b", "/a{b}"])
def test_route_path_rejects(value):
    with pytest.raises(ValueError):
        validate_route_path(value)


def test_safe_project_path_returns_path_inside_project(tmp_path):
    result = safe_project_path(tmp_path, "budgethq", "data/photos")

    assert result == (tmp_path / "budgethq" / "data" / "photos").resolve()


def test_safe_project_path_without_relative_returns_project_dir(tmp_path):
    assert safe_project_path(tmp_path, "budgethq") == (tmp_path / "budgethq").resolve()


@pytest.mark.parametrize(
    "relative", ["../other", "../../etc/passwd", "/etc/passwd", "data/../../x"]
)
def test_safe_project_path_rejects_escape(tmp_path, relative):
    with pytest.raises(ValueError):
        safe_project_path(tmp_path, "budgethq", relative)


def test_safe_project_path_rejects_symlink_escape(tmp_path):
    project = tmp_path / "budgethq"
    project.mkdir()
    (project / "link").symlink_to(Path("/etc"))

    with pytest.raises(ValueError):
        safe_project_path(tmp_path, "budgethq", "link/passwd")


def test_safe_project_path_rejects_bad_slug(tmp_path):
    with pytest.raises(ValueError):
        safe_project_path(tmp_path, "../x")


class _Example(BaseModel):
    slug: Slug
    domain: DomainName
    port: Port


def test_pydantic_types_validate():
    model = _Example(slug="budgethq", domain="andrewallkin.cloud", port=10000)
    assert model.slug == "budgethq"

    with pytest.raises(ValidationError):
        _Example(slug="Bad", domain="andrewallkin.cloud", port=10000)
    with pytest.raises(ValidationError):
        _Example(slug="budgethq", domain="andrewallkin.cloud", port=5432)
