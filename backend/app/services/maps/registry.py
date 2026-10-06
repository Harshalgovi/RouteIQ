"""
Map provider registry.

The single place where a provider id becomes a concrete implementation.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from app.core.config import settings
from app.services.maps.base import MapProvider
from app.services.maps.openstreetmap import OpenStreetMapProvider
from app.services.providers.errors import ProviderConfigurationError

_FACTORIES = {
    "openstreetmap": lambda: OpenStreetMapProvider(
        default_latitude=settings.MAP_DEFAULT_LATITUDE,
        default_longitude=settings.MAP_DEFAULT_LONGITUDE,
        default_zoom=settings.MAP_DEFAULT_ZOOM,
    ),
    # Additional providers register here — e.g.
    # "maptiler": lambda: MapTilerProvider(api_key=settings.MAPTILER_API_KEY),
}

SUPPORTED_PROVIDERS = tuple(_FACTORIES.keys())


@lru_cache(maxsize=None)
def get_map_provider(provider_id: Optional[str] = None) -> MapProvider:
    """Return the configured map provider singleton."""
    resolved = (provider_id or settings.MAP_PROVIDER or "openstreetmap").strip().lower()
    factory = _FACTORIES.get(resolved)
    if factory is None:
        raise ProviderConfigurationError(
            f"Unknown map provider '{resolved}'. "
            f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}.",
            provider=resolved,
        )
    return factory()


def get_map_provider_info() -> dict:
    """Full basemap payload for the frontend. Contains no secrets."""
    try:
        provider = get_map_provider()
    except ProviderConfigurationError as exc:
        return {
            "provider": settings.MAP_PROVIDER,
            "name": "Unconfigured",
            "configured": False,
            "message": exc.message,
            "supported": list(SUPPORTED_PROVIDERS),
            "styles": [],
            "default_view": {
                "latitude": settings.MAP_DEFAULT_LATITUDE,
                "longitude": settings.MAP_DEFAULT_LONGITUDE,
                "zoom": settings.MAP_DEFAULT_ZOOM,
            },
            "default_style": settings.MAP_DEFAULT_STYLE,
        }

    payload = provider.describe()
    requested_style = (settings.MAP_DEFAULT_STYLE or "").strip().lower()
    available = {style["id"] for style in payload["styles"]}
    if requested_style and requested_style in available:
        payload["default_style"] = requested_style
    payload["supported"] = list(SUPPORTED_PROVIDERS)
    return payload
