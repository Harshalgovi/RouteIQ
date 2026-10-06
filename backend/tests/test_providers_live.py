"""
Opt-in live smoke tests against the real OpenStreetMap providers.

Skipped unless ROUTEIQ_LIVE_PROVIDER_TESTS=1 — the default suite never touches
the network.

    ROUTEIQ_LIVE_PROVIDER_TESTS=1 python -m pytest tests/test_providers_live.py -v
"""

import os

import pytest

from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.skipif(
    os.getenv("ROUTEIQ_LIVE_PROVIDER_TESTS") != "1",
    reason="Set ROUTEIQ_LIVE_PROVIDER_TESTS=1 to run live provider smoke tests.",
)

BASE = "/api/v1"

CHICAGO = {
    "origin": {"address": "120 S Wacker Dr, Chicago, IL 60606"},
    "destination": {"address": "600 N Michigan Ave, Chicago, IL 60611"},
}


@pytest.fixture
def live_client():
    with TestClient(app) as client:
        yield client


def test_live_geocode_resolves_real_coordinates(live_client):
    resp = live_client.post(f"{BASE}/geocoding/geocode", json={"address": "120 S Wacker Dr, Chicago, IL 60606"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Chicago city centre.
    assert 41.8 < data["latitude"] < 42.0
    assert -87.8 < data["longitude"] < -87.5


def test_live_route_preview_returns_real_distance(live_client):
    resp = live_client.post(f"{BASE}/routes/preview", json=CHICAGO)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["provider"] == "osrm"
    assert data["distance_meters"] > 0
    assert data["duration_seconds"] > 0
    assert len(data["geometry"]["coordinates"]) > 10


def test_live_route_preview_with_intermediate_stop(live_client):
    payload = {
        **CHICAGO,
        "stops": [{"address": "400 N Halsted St, Chicago, IL 60642"}],
    }
    resp = live_client.post(f"{BASE}/routes/preview", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["stop_count"] == 1
    assert data["total_points"] == 3
    assert data["distance_meters"] > 0


def test_live_route_preview_unresolvable_address(live_client):
    resp = live_client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": {"address": "zzzqqqxxx nonexistent address 99999"},
            "destination": CHICAGO["destination"],
        },
    )
    assert resp.status_code == 404


def test_live_map_config_advertises_tiles(live_client):
    resp = live_client.get(f"{BASE}/maps/config")
    assert resp.status_code == 200
    styles = resp.json()["styles"]
    assert any("openstreetmap.org" in style["url"] for style in styles)