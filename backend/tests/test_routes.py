"""
Tests for POST /api/v1/routes/preview — real routing, no optimisation.
"""

import pytest

from app.services.geocoding.base import Coordinates
from app.services.providers.errors import (
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from tests.provider_fakes import FakeGeocodingService, FakeRoutingService


BASE = "/api/v1"

CHICAGO_ORIGIN = {"latitude": 41.880216, "longitude": -87.636747}
CHICAGO_DESTINATION = {"latitude": 41.891700, "longitude": -87.624300}


def test_preview_route_with_coordinates(client, use_fake_providers):
    """Origin + destination coordinates -> distance, duration, geometry."""
    _, fake_router = use_fake_providers
    resp = client.post(
        f"{BASE}/routes/preview",
        json={"origin": CHICAGO_ORIGIN, "destination": CHICAGO_DESTINATION},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # The fake derives cost from the actual pair, so assert against its own model.
    # The API rounds to 1 decimal, hence the 0.1 tolerance.
    expected_distance, expected_duration = fake_router._pair(
        Coordinates(**CHICAGO_ORIGIN), Coordinates(**CHICAGO_DESTINATION)
    )
    assert data["distance_meters"] == pytest.approx(expected_distance, abs=0.1)
    assert data["duration_seconds"] == pytest.approx(expected_duration, abs=0.1)
    assert data["distance_km"] == pytest.approx(expected_distance / 1000.0, abs=1e-3)
    assert data["duration_minutes"] == pytest.approx(expected_duration / 60.0, abs=0.1)
    assert data["stop_count"] == 0
    assert data["total_points"] == 2
    assert data["geometry"]["type"] == "LineString"
    assert len(data["geometry"]["coordinates"]) == 2
    # GeoJSON order is [longitude, latitude].
    first_point = data["geometry"]["coordinates"][0]
    assert first_point[0] == pytest.approx(CHICAGO_ORIGIN["longitude"], abs=1e-5)
    assert first_point[1] == pytest.approx(CHICAGO_ORIGIN["latitude"], abs=1e-5)
    assert data["bounds"]["min_latitude"] is not None
    assert len(data["legs"]) == 1


def test_preview_route_geocodes_addresses(client, use_fake_providers):
    """Addresses are resolved by the backend geocoding service."""
    resp = client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": {"address": "120 S Wacker Dr, Chicago, IL 60606"},
            "destination": {"address": "600 N Michigan Ave, Chicago, IL 60611"},
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["stop_count"] == 0
    assert len(data["waypoints"]) == 2
    assert data["waypoints"][0]["role"] == "origin"
    assert data["waypoints"][1]["role"] == "destination"
    # geocoded=True proves coordinates were resolved server-side.
    assert data["waypoints"][0]["geocoded"] is True
    assert data["waypoints"][0]["latitude"] == pytest.approx(41.880216, abs=1e-4)


def test_preview_route_with_intermediate_stops(client, use_fake_providers):
    resp = client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": CHICAGO_ORIGIN,
            "destination": CHICAGO_DESTINATION,
            "stops": [
                {"address": "400 N Halsted St, Chicago, IL 60642"},
                {"latitude": 41.8984, "longitude": -87.6312, "label": "Central Pharmacy"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["stop_count"] == 2
    assert data["total_points"] == 4
    roles = [wp["role"] for wp in data["waypoints"]]
    assert roles == ["origin", "stop", "stop", "destination"]
    assert [wp["order"] for wp in data["waypoints"]] == [0, 1, 2, 3]
    assert len(data["legs"]) == 3


def test_preview_route_preserves_stop_order_without_optimising(client, use_fake_providers):
    """
    This phase only previews a route — the caller-supplied stop order is used
    verbatim. No optimisation happens.
    """
    resp = client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": CHICAGO_ORIGIN,
            "destination": CHICAGO_DESTINATION,
            "stops": [{"latitude": 41.8893, "longitude": -87.6474, "label": "Halsted"}],
        },
    )
    assert resp.status_code == 200
    labels = [wp["label"] for wp in resp.json()["waypoints"]]
    assert labels[1] == "Halsted"


def test_preview_route_echoes_delivery_reference(client, use_fake_providers):
    resp = client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": CHICAGO_ORIGIN,
            "destination": CHICAGO_DESTINATION,
            "stops": [
                {"latitude": 41.8893, "longitude": -87.6474, "delivery_id": 7, "label": "Stop 1"}
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["waypoints"][1]["reference_id"] == "delivery:7"


# ── Validation ────────────────────────────────────────────────────────────────


def test_preview_route_requires_destination(client):
    resp = client.post(f"{BASE}/routes/preview", json={"origin": CHICAGO_ORIGIN})
    assert resp.status_code == 422


def test_preview_route_requires_coordinates_or_address(client):
    resp = client.post(f"{BASE}/routes/preview", json={"origin": {}, "destination": CHICAGO_DESTINATION})
    assert resp.status_code == 422


def test_preview_route_rejects_out_of_range_latitude(client):
    resp = client.post(
        f"{BASE}/routes/preview",
        json={"origin": {"latitude": 200.0, "longitude": 0.0}, "destination": CHICAGO_DESTINATION},
    )
    assert resp.status_code == 422


def test_preview_route_rejects_lone_latitude(client):
    resp = client.post(
        f"{BASE}/routes/preview",
        json={"origin": {"latitude": 41.88}, "destination": CHICAGO_DESTINATION},
    )
    assert resp.status_code == 422


def test_preview_route_rejects_too_many_stops(client):
    stops = [{"latitude": 41.88 + i * 0.001, "longitude": -87.63} for i in range(30)]
    resp = client.post(
        f"{BASE}/routes/preview",
        json={"origin": CHICAGO_ORIGIN, "destination": CHICAGO_DESTINATION, "stops": stops},
    )
    assert resp.status_code == 422


# ── Error handling ────────────────────────────────────────────────────────────


def test_preview_route_unresolvable_address_returns_404(client, use_fake_providers):
    resp = client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": {"address": "999999 Nowhere Street, Springfield"},
            "destination": CHICAGO_DESTINATION,
        },
    )
    assert resp.status_code == 404
    assert "No coordinates" in resp.json()["detail"]


@pytest.mark.parametrize(
    "error, expected_status",
    [
        (ProviderTimeoutError(provider="fake"), 504),
        (ProviderUnavailableError(provider="fake"), 502),
        (ProviderRateLimitError(provider="fake"), 429),
    ],
)
def test_preview_route_provider_failures_map_to_http(
    client, use_fake_providers, error, expected_status
):
    _, fake_router = use_fake_providers
    fake_router.fail_with = error
    resp = client.post(
        f"{BASE}/routes/preview",
        json={"origin": CHICAGO_ORIGIN, "destination": CHICAGO_DESTINATION},
    )
    assert resp.status_code == expected_status
    detail = resp.json()["detail"]
    # Never leak exception class names, provider payloads or stack traces.
    assert "Traceback" not in detail
    assert "ProviderTimeoutError" not in detail


def test_preview_route_never_leaks_raw_exceptions(client, use_fake_providers):
    _, fake_router = use_fake_providers
    fake_router.fail_with = RuntimeError("boom: internal detail /secret/path")
    resp = client.post(
        f"{BASE}/routes/preview",
        json={"origin": CHICAGO_ORIGIN, "destination": CHICAGO_DESTINATION},
    )
    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert "boom" not in detail
    assert "/secret/path" not in detail


def test_preview_route_geocoding_failure_returns_502(client, use_fake_providers):
    fake_geocoder, _ = use_fake_providers

    async def _boom(*args, **kwargs):
        raise ProviderTimeoutError(provider="fake")

    fake_geocoder.geocode = _boom  # type: ignore[assignment]
    resp = client.post(
        f"{BASE}/routes/preview",
        json={
            "origin": {"address": "120 S Wacker Dr, Chicago, IL 60606"},
            "destination": CHICAGO_DESTINATION,
        },
    )
    assert resp.status_code == 504


# ── Caching / de-duplication ──────────────────────────────────────────────────


def test_preview_route_delegates_caching_to_the_provider(client, use_fake_providers):
    """
    The preview endpoint performs no caching of its own — de-duplication lives in
    the routing provider (see test_routing_provider.py). Repeated calls must stay
    consistent and reach the provider.
    """
    _, fake_router = use_fake_providers
    payload = {"origin": CHICAGO_ORIGIN, "destination": CHICAGO_DESTINATION}

    first = client.post(f"{BASE}/routes/preview", json=payload)
    second = client.post(f"{BASE}/routes/preview", json=payload)

    assert first.status_code == 200 and second.status_code == 200
    assert len(fake_router.calls) == 2
    assert first.json()["distance_km"] == second.json()["distance_km"]
    assert first.json()["duration_minutes"] == second.json()["duration_minutes"]


# ── Provider metadata ─────────────────────────────────────────────────────────


def test_routing_providers_endpoint(client):
    resp = client.get(f"{BASE}/routes/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider"]
    assert "osrm" in data["supported"]
    assert "driving" in data["profiles"]
    # Secrets are never part of provider metadata.
    assert "api_key" not in data
    assert "ROUTING_API_KEY" not in data
