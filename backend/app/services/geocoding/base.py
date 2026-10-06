"""
GeocodingService abstraction.

RouteIQ depends on this interface only. Swapping Nominatim for Google Geocoding,
Mapbox, Geoapify, Photon, or an internal gazetteer means implementing
``GeocodingService`` and registering it — no caller changes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, replace
from typing import Optional


@dataclass(frozen=True)
class Coordinates:
    """A validated WGS-84 coordinate pair."""

    latitude: float
    longitude: float

    def as_tuple(self) -> tuple[float, float]:
        return (self.latitude, self.longitude)

    def as_geojson(self) -> list[float]:
        """GeoJSON ordering is [longitude, latitude]."""
        return [self.longitude, self.latitude]


@dataclass(frozen=True)
class GeocodeResult:
    """Normalised geocoding response."""

    coordinates: Coordinates
    formatted_address: Optional[str] = None
    display_name: Optional[str] = None
    provider: str = ""
    #: Optional provider reference id (e.g. Nominatim place id / osm_id).
    provider_reference: Optional[str] = None
    #: Bounding box in [min_lat, min_lon, max_lat, max_lon] order, when offered.
    bounding_box: Optional[tuple[float, float, float, float]] = None
    confidence: Optional[float] = None
    #: True when the provider implementation served this from its local cache.
    cached: bool = False
    raw: dict = field(default_factory=dict, repr=False, compare=False)

    def as_cached(self) -> "GeocodeResult":
        """Return the same result flagged as cache-served."""
        if self.cached:
            return self
        return replace(self, cached=True)


class GeocodingService(ABC):
    """Contract every geocoding provider implementation must satisfy."""

    #: Logical provider id, e.g. "nominatim".
    provider_id: str = "abstract"
    #: Human-readable provider name for the UI / diagnostics.
    provider_name: str = "Abstract Geocoding Provider"
    #: Whether this provider requires a server-side secret.
    requires_api_key: bool = False

    @abstractmethod
    async def geocode(
        self,
        address: str,
        *,
        country_codes: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Optional[GeocodeResult]:
        """
        Resolve a free-form address to coordinates.

        Returns ``None`` when the provider is healthy but has no match.
        Raises a Provider* error for transport failures, rate limits, timeouts,
        or invalid input.
        """

    async def reverse_geocode(self, coordinates: Coordinates) -> Optional[str]:
        """Optional capability — resolve coordinates back to a human address."""
        raise NotImplementedError

    def describe(self) -> dict:
        """Provider metadata safe to expose to the frontend."""
        return {
            "provider": self.provider_id,
            "name": self.provider_name,
            "requires_api_key": self.requires_api_key,
            "configured": True,
        }
