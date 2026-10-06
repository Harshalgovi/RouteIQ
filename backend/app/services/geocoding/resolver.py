"""
High-level geocoding helpers used by domain services (deliveries, etc.).

Keeps geocoding out of both the API layer and the repositories.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.services.geocoding.base import Coordinates, GeocodeResult
from app.services.geocoding.registry import get_geocoding_service

logger = logging.getLogger("routeiq.services.geocoding")


async def resolve_address(address: str) -> Optional[GeocodeResult]:
    """
    Resolve an address to coordinates using the configured geocoding provider.

    Returns ``None`` when the provider is healthy but found no match.
    Raises Provider* errors for transport failures / rate limits / timeouts.
    """
    cleaned = (address or "").strip()
    if not cleaned:
        return None
    return await get_geocoding_service().geocode(cleaned)


async def reverse_lookup(latitude: float, longitude: float) -> Optional[str]:
    """Best-effort human-readable address for a coordinate pair."""
    service = get_geocoding_service()
    try:
        return await service.reverse_geocode(Coordinates(latitude=latitude, longitude=longitude))
    except NotImplementedError:
        return None
