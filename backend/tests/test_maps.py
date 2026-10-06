"""
Tests for the map provider abstraction and the /maps API.
"""

import pytest

from app.services.maps.base import MapProvider, TileStyle
from app.services.maps.openstreetmap import OpenStreetMapProvider
from app.services.providers.errors import ProviderConfigurationError

API_BASE = "/api/v1"


# ── Provider contract ─────────────────────────────────────────────────────────


def test_openstreetmap_provider_exposes_styles():
    provider = OpenStreetMapProvider(default_latitude=41.88, default_longitude=-87.63, default_zoom=13)
    style_ids = [style.id for style in provider.get_styles()]
    assert "standard" in style_ids
    assert "dark" in style_ids


def test_openstreetmap_default_view_from_settings():
    provider = OpenStreetMapProvider(default_latitude=41.5, default_longitude=-87.5, default_zoom=9)
    view = provider.default_view()
    assert view.latitude == 41.5
    assert view.longitude == -87.5
    assert view.zoom == 9


def test_get_style_falls_back_to_first_style():
    provider = OpenStreetMapProvider()
    fallback = provider.get_style("does-not-exist")
    assert fallback.id == provider.get_styles()[0].id


def test_tile_style_serialisation_includes_attribution():
    style = TileStyle(
        id="x", name="X", url="https://x/{z}/{x}/{y}.png", attribution="© someone"
    ).as_dict()
    assert style["attribution"] == "© someone"
    assert style["max_zoom"] == 19


def test_registry_returns_openstreetmap_provider():
    from app.services.maps.registry import get_map_provider

    provider = get_map_provider()
    assert isinstance(provider, MapProvider)
    assert provider.provider_id == "openstreetmap"


def test_registry_rejects_unknown_provider():
    from app.services.maps.registry import get_map_provider

    with pytest.raises(ProviderConfigurationError):
        get_map_provider("google-maps")


# ── API ───────────────────────────────────────────────────────────────────────


def test_map_config_endpoint(client):
    resp = client.get(f"{API_BASE}/maps/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider"] == "openstreetmap"
    assert data["styles"], "at least one basemap style must be advertised"
    assert data["default_view"]["zoom"] >= 1
    for style in data["styles"]:
        assert style["url"].startswith("http")
        assert style["attribution"], "every basemap must carry attribution"


def test_map_providers_bundle_endpoint(client):
    resp = client.get(f"{API_BASE}/maps/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"map", "routing", "geocoding"}
    assert data["routing"]["provider"]
    assert data["geocoding"]["provider"]
    # No server-side secrets leak to the client.
    assert "GEOCODING_API_KEY" not in resp.text
    assert "ROUTING_API_KEY" not in resp.text
