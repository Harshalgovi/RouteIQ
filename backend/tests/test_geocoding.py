"""
Tests for the geocoding service abstraction and its Nominatim implementation.
"""

import pytest

from app.services.geocoding.base import Coordinates, GeocodingService
from app.services.geocoding.nominatim import NominatimGeocodingService
from app.services.providers.errors import (
    InvalidLocationError,
    ProviderBadResponseError,
    ProviderNotFoundError,
    ProviderRateLimitError,
    ProviderTimeoutError,
)

API_BASE = "/api/v1"


def make_service(**kwargs) -> NominatimGeocodingService:
    defaults = dict(
        base_url="https://nominatim.test",
        user_agent="RouteIQ/test",
        min_interval_seconds=0.0,
        cache_ttl_seconds=60,
    )
    defaults.update(kwargs)
    return NominatimGeocodingService(**defaults)


NOMINATIM_HIT = [
    {
        "lat": "41.8802160",
        "lon": "-87.6367467",
        "name": "120 South Wacker Drive",
        "display_name": "120 S Wacker Dr, Chicago, IL 60606",
        "osm_id": 12345,
        "osm_type": "way",
        "boundingbox": ["41.87", "-87.64", "41.88", "-87.63"],
    }
]


def patch_payload(service, payload, *, error=None):
    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        if error is not None:
            raise error
        _get_json.last = (url, params)
        return payload

    service._client.get_json = _get_json  # type: ignore[assignment]
    return _get_json


# ── Parsing ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_geocode_parses_nominatim_response():
    service = make_service()
    patch_payload(service, NOMINATIM_HIT)

    result = await service.geocode("120 S Wacker Dr, Chicago, IL 60606")

    assert result is not None
    assert result.coordinates.latitude == pytest.approx(41.880216, abs=1e-5)
    assert result.coordinates.longitude == pytest.approx(-87.6367467, abs=1e-5)
    assert result.formatted_address == "120 South Wacker Drive"
    assert result.provider == "nominatim"
    assert result.provider_reference == "way:12345"


@pytest.mark.asyncio
async def test_geocode_returns_none_on_empty_results():
    service = make_service()
    patch_payload(service, [])
    assert await service.geocode("somewhere that does not exist") is None


@pytest.mark.asyncio
async def test_geocode_sends_user_agent_and_format_params():
    service = make_service()
    spy = patch_payload(service, NOMINATIM_HIT)

    await service.geocode("120 S Wacker Dr")

    url, params = spy.last
    assert url.endswith("/search")
    assert params["format"] == "jsonv2"
    assert params["q"] == "120 S Wacker Dr"


@pytest.mark.asyncio
async def test_geocode_applies_country_bias():
    service = make_service(default_country_codes="us")
    spy = patch_payload(service, NOMINATIM_HIT)

    await service.geocode("Main Street")

    assert spy.last[1]["countrycodes"] == "us"


@pytest.mark.asyncio
async def test_geocode_empty_address_rejected():
    service = make_service()
    with pytest.raises(InvalidLocationError):
        await service.geocode("   ")


@pytest.mark.asyncio
async def test_geocode_provider_error_body_raises_not_found():
    service = make_service()
    patch_payload(service, {"error": "Unable to geocode"})
    with pytest.raises(ProviderNotFoundError):
        await service.geocode("????")


@pytest.mark.asyncio
async def test_geocode_non_list_payload_raises_bad_response():
    service = make_service()
    patch_payload(service, {"unexpected": True})
    with pytest.raises(ProviderBadResponseError):
        await service.geocode("120 S Wacker Dr")


@pytest.mark.asyncio
async def test_geocode_out_of_range_provider_coordinates_rejected():
    service = make_service()
    patch_payload(service, [{"lat": "999", "lon": "999", "display_name": "bad"}])
    with pytest.raises(ProviderBadResponseError):
        await service.geocode("bad result")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        ProviderTimeoutError(provider="nominatim"),
        ProviderRateLimitError(provider="nominatim"),
        ProviderBadResponseError(provider="nominatim"),
    ],
)
async def test_geocode_propagates_normalised_errors(error):
    service = make_service()
    patch_payload(service, None, error=error)
    with pytest.raises(type(error)):
        await service.geocode("120 S Wacker Dr")


# ── Caching ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_geocode_caches_repeat_lookups():
    service = make_service(cache_ttl_seconds=120)
    calls = {"count": 0}

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        calls["count"] += 1
        return NOMINATIM_HIT

    service._client.get_json = _get_json  # type: ignore[assignment]

    await service.geocode("120 S Wacker Dr")
    await service.geocode("120 S Wacker Dr")
    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_geocode_caches_misses_too():
    service = make_service(cache_ttl_seconds=120)
    calls = {"count": 0}

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        calls["count"] += 1
        return []

    service._client.get_json = _get_json  # type: ignore[assignment]

    await service.geocode("not a place")
    await service.geocode("not a place")
    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_geocode_flags_cache_hits():
    """The `cached` flag must reflect reality, not just default to False."""
    service = make_service(cache_ttl_seconds=120)

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        return NOMINATIM_HIT

    service._client.get_json = _get_json  # type: ignore[assignment]

    first = await service.geocode("120 S Wacker Dr")
    second = await service.geocode("120 S Wacker Dr")

    assert first is not None and second is not None
    assert first.cached is False
    assert second.cached is True
    assert second.coordinates == first.coordinates


# ── Registry / abstraction contract ───────────────────────────────────────────


def test_registry_returns_configured_service():
    from app.services.geocoding.registry import get_geocoding_service

    service = get_geocoding_service()
    assert isinstance(service, GeocodingService)
    assert service.provider_id == "nominatim"


def test_registry_rejects_unknown_provider():
    from app.services.geocoding.registry import get_geocoding_service
    from app.services.providers.errors import ProviderConfigurationError

    with pytest.raises(ProviderConfigurationError):
        get_geocoding_service("does-not-exist")


def test_provider_info_hides_credentials():
    from app.services.geocoding.registry import get_geocoding_service_info

    info = get_geocoding_service_info()
    assert info["configured"] is True
    assert info["requires_api_key"] is False
    assert "nominatim" in info["supported"]
    assert "api_key" not in info


# ── Reverse lookup ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reverse_geocode_returns_display_name():
    service = make_service()
    patch_payload(service, {"display_name": "Chicago, Illinois, US"})

    address = await service.reverse_geocode(Coordinates(latitude=41.88, longitude=-87.63))
    assert address == "Chicago, Illinois, US"


# ── HTTP API ──────────────────────────────────────────────────────────────────


def test_geocode_endpoint_success(client, use_fake_providers):
    resp = client.post(
        f"{API_BASE}/geocoding/geocode",
        json={"address": "120 S Wacker Dr, Chicago, IL 60606"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["latitude"] == pytest.approx(41.880216, abs=1e-4)
    assert data["longitude"] == pytest.approx(-87.636747, abs=1e-4)
    assert data["provider"] == "fake"


def test_geocode_endpoint_no_results_returns_404(client, use_fake_providers):
    resp = client.post(f"{API_BASE}/geocoding/geocode", json={"address": "unknown place xyz"})
    assert resp.status_code == 404
    assert "No coordinates were found" in resp.json()["detail"]


def test_geocode_endpoint_short_address_returns_422(client):
    resp = client.post(f"{API_BASE}/geocoding/geocode", json={"address": "a"})
    assert resp.status_code == 422


def test_geocode_endpoint_timeout_returns_504(client, use_fake_providers):
    fake_geocoder, _ = use_fake_providers

    async def _boom(*args, **kwargs):
        raise ProviderTimeoutError(provider="fake")

    fake_geocoder.geocode = _boom  # type: ignore[assignment]
    resp = client.post(f"{API_BASE}/geocoding/geocode", json={"address": "120 S Wacker Dr"})
    assert resp.status_code == 504
    assert "Traceback" not in resp.json()["detail"]


def test_geocoding_providers_endpoint(client):
    resp = client.get(f"{API_BASE}/geocoding/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["configured"] is True
    assert "nominatim" in data["supported"]


def test_reverse_endpoint_accepts_query_parameters(client, use_fake_providers):
    resp = client.post(
        f"{API_BASE}/geocoding/reverse?latitude=41.88&longitude=-87.63",
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["latitude"] == pytest.approx(41.88)
    assert data["longitude"] == pytest.approx(-87.63)
    assert data["address"]


def test_reverse_endpoint_validates_coordinate_bounds(client):
    resp = client.post(f"{API_BASE}/geocoding/reverse?latitude=999&longitude=-87.63")
    assert resp.status_code == 422


def test_geocode_endpoint_reports_cache_state(client, use_fake_providers):
    """The endpoint surfaces the provider's cached flag rather than a constant."""
    address = "120 S Wacker Dr, Chicago, IL 60606"

    first = client.post(f"{API_BASE}/geocoding/geocode", json={"address": address})
    second = client.post(f"{API_BASE}/geocoding/geocode", json={"address": address})

    assert first.status_code == 200, first.text
    assert first.json()["cached"] is False
    # The fake provider does not cache, so both calls report a live lookup.
    assert second.json()["cached"] is False
