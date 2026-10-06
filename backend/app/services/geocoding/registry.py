"""
Geocoding provider registry.

The single place where a provider id becomes a concrete implementation. Nothing
else in RouteIQ imports a vendor-specific geocoding module.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from app.core.config import settings
from app.services.geocoding.base import GeocodingService
from app.services.geocoding.nominatim import NominatimGeocodingService
from app.services.providers.errors import ProviderConfigurationError

_FACTORIES = {
    "nominatim": lambda: NominatimGeocodingService(
        base_url=settings.GEOCODING_BASE_URL,
        user_agent=settings.GEOCODING_USER_AGENT,
        timeout_seconds=settings.GEOCODING_TIMEOUT_SECONDS,
        min_interval_seconds=settings.GEOCODING_MIN_INTERVAL_SECONDS,
        cache_ttl_seconds=settings.GEOCODING_CACHE_TTL_SECONDS,
        cache_max_entries=settings.GEOCODING_CACHE_MAX_ENTRIES,
        default_language=settings.GEOCODING_LANGUAGE,
        default_country_codes=settings.GEOCODING_COUNTRY_CODES,
        api_key=settings.GEOCODING_API_KEY,
    ),
    # Additional providers register here — e.g.
    # "photon": lambda: PhotonGeocodingService(...),
}

SUPPORTED_PROVIDERS = tuple(_FACTORIES.keys())


@lru_cache(maxsize=None)
def get_geocoding_service(provider_id: Optional[str] = None) -> GeocodingService:
    """Return the configured geocoding service singleton."""
    resolved = (provider_id or settings.GEOCODING_PROVIDER or "nominatim").strip().lower()
    factory = _FACTORIES.get(resolved)
    if factory is None:
        raise ProviderConfigurationError(
            f"Unknown geocoding provider '{resolved}'. "
            f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}.",
            provider=resolved,
        )
    return factory()


def get_geocoding_service_info() -> dict:
    """Provider metadata for the frontend — contains no secrets."""
    try:
        service = get_geocoding_service()
    except ProviderConfigurationError as exc:
        return {
            "provider": settings.GEOCODING_PROVIDER,
            "name": "Unconfigured",
            "requires_api_key": False,
            "configured": False,
            "message": exc.message,
            "supported": list(SUPPORTED_PROVIDERS),
        }
    return {**service.describe(), "supported": list(SUPPORTED_PROVIDERS)}
