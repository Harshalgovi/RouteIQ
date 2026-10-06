"""
Routing provider registry.

The single place where a provider id becomes a concrete implementation.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from app.core.config import settings
from app.services.providers.errors import ProviderConfigurationError
from app.services.routing.base import RoutingService
from app.services.routing.osrm import SUPPORTED_PROFILES, OsrmRoutingService

_FACTORIES = {
    "osrm": lambda: OsrmRoutingService(
        base_url=settings.ROUTING_BASE_URL,
        timeout_seconds=settings.ROUTING_TIMEOUT_SECONDS,
        min_interval_seconds=settings.ROUTING_MIN_INTERVAL_SECONDS,
        cache_ttl_seconds=settings.ROUTING_CACHE_TTL_SECONDS,
        cache_max_entries=settings.ROUTING_CACHE_MAX_ENTRIES,
        default_profile=settings.ROUTING_PROFILE,
        api_key=settings.ROUTING_API_KEY,
    ),
    # Additional providers register here — e.g.
    # "graphhopper": lambda: GraphHopperRoutingService(...),
}

SUPPORTED_PROVIDERS = tuple(_FACTORIES.keys())


@lru_cache(maxsize=None)
def get_routing_service(provider_id: Optional[str] = None) -> RoutingService:
    """Return the configured routing service singleton."""
    resolved = (provider_id or settings.ROUTING_PROVIDER or "osrm").strip().lower()
    factory = _FACTORIES.get(resolved)
    if factory is None:
        raise ProviderConfigurationError(
            f"Unknown routing provider '{resolved}'. "
            f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}.",
            provider=resolved,
        )
    return factory()


def get_routing_service_info() -> dict:
    """Provider metadata for the frontend — contains no secrets."""
    try:
        service = get_routing_service()
    except ProviderConfigurationError as exc:
        return {
            "provider": settings.ROUTING_PROVIDER,
            "name": "Unconfigured",
            "requires_api_key": False,
            "configured": False,
            "message": exc.message,
            "supported": list(SUPPORTED_PROVIDERS),
        }
    return {**service.describe(), "supported": list(SUPPORTED_PROVIDERS), "profiles": list(SUPPORTED_PROFILES)}
