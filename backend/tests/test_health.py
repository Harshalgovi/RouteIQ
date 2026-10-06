"""
Unit tests for health check API endpoints.
"""


def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "RouteIQ" in data["message"]


def test_health_endpoint(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "RouteIQ"
    assert data["version"] == "0.1.0"
    assert data["database"] == "connected"
