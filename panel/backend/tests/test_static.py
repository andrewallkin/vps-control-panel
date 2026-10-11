def test_spa_fallback_serves_index_html(client):
    response = client.get("/dashboard/settings")

    assert response.status_code == 200
    assert response.text == "<!DOCTYPE html><html><body>panel</body></html>"


def test_existing_static_file_is_served(client):
    response = client.get("/app.js")

    assert response.status_code == 200
    assert response.text == "// panel-app"


def test_unknown_api_route_returns_404_json(client):
    response = client.get("/api/unknown")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert "detail" in response.json()
