"""
Tests for delivery geocoding integration.

Creating a delivery with an address but no coordinates must geocode on the
backend and persist the result. The frontend never geocodes.
"""

import pytest

from app.services.geocoding.base import Coordinates, GeocodeResult
from app.services.providers.errors import (
    ProviderNotFoundError,
    ProviderRateLimitError,
    ProviderTimeoutError,
)

BASE = "/api/v1"

ADDRESS_PAYLOAD = {
    "tracking_number": "RT-GEO-001",
    "customer_name": "Apex Tech Hub",
    "phone": "+1 (312) 555-0192",
    "address": "120 S Wacker Dr, Chicago, IL 60606",
    "package_weight": 45.0,
    "volume_m3": 0.45,
    "priority": "urgent",
    "status": "pending",
}


def geocode_result(lat=41.880216, lon=-87.636747) -> GeocodeResult:
    return GeocodeResult(
        coordinates=Coordinates(latitude=lat, longitude=lon),
        formatted_address="120 South Wacker Drive",
        provider="fake",
    )


def test_create_delivery_geocodes_missing_coordinates(client, patch_delivery_resolver):
    patch_delivery_resolver(result=geocode_result())

    resp = client.post(f"{BASE}/deliveries", json=ADDRESS_PAYLOAD)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["latitude"] == pytest.approx(41.880216, abs=1e-4)
    assert data["longitude"] == pytest.approx(-87.636747, abs=1e-4)


def test_create_delivery_skips_geocoding_when_coordinates_supplied(
    client, patch_delivery_resolver
):
    """Explicit coordinates mean no outbound geocoding request is made."""
    called = {"count": 0}

    async def _resolver(address):  # noqa: ARG001
        called["count"] += 1
        return geocode_result()

    import importlib

    delivery_module = importlib.import_module("app.services.delivery_service")
    import pytest as _pytest

    _pytest.MonkeyPatch().setattr(delivery_module, "resolve_address", _resolver)

    payload = {**ADDRESS_PAYLOAD, "latitude": 41.9, "longitude": -87.6}
    resp = client.post(f"{BASE}/deliveries", json=payload)

    assert resp.status_code == 201, resp.text
    assert resp.json()["latitude"] == pytest.approx(41.9)
    assert called["count"] == 0


def test_create_delivery_unresolvable_address_returns_404(client, patch_delivery_resolver):
    patch_delivery_resolver(result=None)

    resp = client.post(f"{BASE}/deliveries", json=ADDRESS_PAYLOAD)
    assert resp.status_code == 404
    assert "No coordinates could be found" in resp.json()["detail"]


def test_create_delivery_geocoding_timeout_returns_504(client, patch_delivery_resolver):
    patch_delivery_resolver(error=ProviderTimeoutError(provider="fake"))

    resp = client.post(f"{BASE}/deliveries", json=ADDRESS_PAYLOAD)
    assert resp.status_code == 504
    assert "Traceback" not in resp.json()["detail"]


def test_create_delivery_geocoding_rate_limit_returns_429(client, patch_delivery_resolver):
    patch_delivery_resolver(error=ProviderRateLimitError(provider="fake"))

    resp = client.post(f"{BASE}/deliveries", json=ADDRESS_PAYLOAD)
    assert resp.status_code == 429
    assert resp.headers.get("Retry-After")


def test_update_delivery_address_regeocodes(client, patch_delivery_resolver):
    patch_delivery_resolver(result=geocode_result())
    create_resp = client.post(
        f"{BASE}/deliveries", json={**ADDRESS_PAYLOAD, "latitude": 41.9, "longitude": -87.6}
    )
    delivery_id = create_resp.json()["id"]

    resp = client.put(f"{BASE}/deliveries/{delivery_id}", json={"address": "600 N Michigan Ave"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["latitude"] == pytest.approx(41.880216, abs=1e-4)


def test_update_delivery_without_address_does_not_regeocode(client, patch_delivery_resolver):
    patch_delivery_resolver(result=geocode_result())
    create_resp = client.post(
        f"{BASE}/deliveries", json={**ADDRESS_PAYLOAD, "latitude": 41.9, "longitude": -87.6}
    )
    delivery_id = create_resp.json()["id"]

    resp = client.put(f"{BASE}/deliveries/{delivery_id}", json={"status": "in_transit"})
    assert resp.status_code == 200
    assert resp.json()["latitude"] == pytest.approx(41.9)


def test_geocode_delivery_endpoint(client, patch_delivery_resolver):
    patch_delivery_resolver(result=geocode_result(41.8917, -87.6243))
    create_resp = client.post(
        f"{BASE}/deliveries", json={**ADDRESS_PAYLOAD, "latitude": 41.9, "longitude": -87.6}
    )
    delivery_id = create_resp.json()["id"]

    resp = client.post(f"{BASE}/deliveries/{delivery_id}/geocode")
    assert resp.status_code == 200, resp.text
    assert resp.json()["latitude"] == pytest.approx(41.8917, abs=1e-4)


def test_geocode_delivery_endpoint_not_found(client):
    resp = client.post(f"{BASE}/deliveries/99999/geocode")
    assert resp.status_code == 404


def test_geocode_delivery_endpoint_unresolvable(client, patch_delivery_resolver):
    patch_delivery_resolver(result=None)
    create_resp = client.post(
        f"{BASE}/deliveries", json={**ADDRESS_PAYLOAD, "latitude": 41.9, "longitude": -87.6}
    )
    delivery_id = create_resp.json()["id"]

    resp = client.post(f"{BASE}/deliveries/{delivery_id}/geocode")
    assert resp.status_code == 404
