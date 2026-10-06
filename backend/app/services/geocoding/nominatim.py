"""
Nominatim geocoding provider (OpenStreetMap).

Keyless, requires an identifying User-Agent, and is rate limited to roughly one
request per second — all three concerns are handled by ProviderHttpClient and the
TTL cache in front of it.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.services.geocoding.base import Coordinates, GeocodeResult, GeocodingService
from app.services.providers.cache import TTLCache
from app.services.providers.errors import (
    InvalidLocationError,
    ProviderBadResponseError,
    ProviderNotFoundError,
)
from app.services.providers.http import ProviderHttpClient

logger = logging.getLogger("routeiq.providers.geocoding.nominatim")


class NominatimGeocodingService(GeocodingService):
    provider_id = "nominatim"
    provider_name = "OpenStreetMap Nominatim"
    requires_api_key = False

    def __init__(
        self,
        *,
        base_url: str,
        user_agent: str,
        timeout_seconds: float = 10.0,
        min_interval_seconds: float = 1.0,
        cache_ttl_seconds: int = 86400,
        cache_max_entries: int = 2048,
        default_language: str = "en",
        default_country_codes: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_language = default_language
        self.default_country_codes = default_country_codes
        self._client = ProviderHttpClient(
            provider=self.provider_id,
            timeout_seconds=timeout_seconds,
            min_interval_seconds=min_interval_seconds,
            user_agent=user_agent,
        )
        self._cache: TTLCache[Optional[GeocodeResult]] = TTLCache(
            max_entries=cache_max_entries, ttl_seconds=cache_ttl_seconds
        )

    # -- GeocodingService ----------------------------------------------------

    async def geocode(
        self,
        address: str,
        *,
        country_codes: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Optional[GeocodeResult]:
        cleaned = (address or "").strip()
        if not cleaned:
            raise InvalidLocationError(
                "An address is required to look up coordinates.", provider=self.provider_id
            )

        params = {
            "q": cleaned,
            "format": "jsonv2",
            "limit": "1",
            "addressdetails": "0",
            "dedupe": "1",
        }
        effective_language = language or self.default_language
        if effective_language:
            params["accept-language"] = effective_language
        effective_countries = country_codes or self.default_country_codes
        if effective_countries:
            params["countrycodes"] = effective_countries

        cache_key = "|".join(f"{k}={v}" for k, v in sorted(params.items()))
        if self._cache.has(cache_key):
            cached_result = self._cache.get(cache_key)
            return cached_result.as_cached() if cached_result is not None else None

        payload = await self._client.get_json(f"{self.base_url}/search", params=params)
        result = self._parse(payload, fallback_query=cleaned)
        # Cache the miss too, so repeated bad addresses do not hammer Nominatim.
        self._cache.set(cache_key, result)
        return result

    async def reverse_geocode(self, coordinates: Coordinates) -> Optional[str]:
        params = {
            "lat": f"{coordinates.latitude}",
            "lon": f"{coordinates.longitude}",
            "format": "jsonv2",
            "zoom": "18",
        }
        payload = await self._client.get_json(f"{self.base_url}/reverse", params=params)
        if not isinstance(payload, dict):
            return None
        name = payload.get("display_name")
        return name if isinstance(name, str) and name else None

    # -- Internals -----------------------------------------------------------

    def _parse(self, payload: object, *, fallback_query: str) -> Optional[GeocodeResult]:
        if payload is None:
            return None
        if not isinstance(payload, list):
            # Nominatim returns `{"error": ...}` for malformed queries.
            if isinstance(payload, dict) and payload.get("error"):
                logger.info("[nominatim] query rejected: %s", payload.get("error"))
                raise ProviderNotFoundError(
                    "The geocoding provider could not interpret that address.",
                    provider=self.provider_id,
                )
            raise ProviderBadResponseError(provider=self.provider_id)

        if not payload:
            return None

        first = payload[0]
        if not isinstance(first, dict):
            raise ProviderBadResponseError(provider=self.provider_id)

        try:
            latitude = float(first["lat"])
            longitude = float(first["lon"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderBadResponseError(provider=self.provider_id) from exc

        if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
            logger.warning("[nominatim] provider returned out-of-range coordinates")
            raise ProviderBadResponseError(
                "The geocoding provider returned coordinates outside valid bounds.",
                provider=self.provider_id,
            )

        bounding_box = first.get("boundingbox")
        bbox = None
        if isinstance(bounding_box, list) and len(bounding_box) == 4:
            try:
                south, north, west, east = (float(v) for v in bounding_box)
                bbox = (south, west, north, east)
            except (TypeError, ValueError):
                bbox = None

        reference = None
        if first.get("osm_id") is not None:
            osm_type = first.get("osm_type") or "node"
            reference = f"{osm_type}:{first['osm_id']}"

        return GeocodeResult(
            coordinates=Coordinates(latitude=latitude, longitude=longitude),
            formatted_address=first.get("name") or fallback_query,
            display_name=first.get("display_name"),
            provider=self.provider_id,
            provider_reference=reference,
            bounding_box=bbox,
            raw=first,
        )
