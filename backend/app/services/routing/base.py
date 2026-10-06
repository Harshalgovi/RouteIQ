"""
RoutingService abstraction.

RouteIQ depends on this interface only. Swapping OSRM for GraphHopper, Valhalla,
Mapbox Directions, or an in-house engine means implementing ``RoutingService`` and
registering it — no caller changes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Sequence

from app.services.geocoding.base import Coordinates


@dataclass(frozen=True)
class RouteStop:
    """An input waypoint for a route calculation."""

    coordinates: Coordinates
    label: Optional[str] = None
    #: Optional RouteIQ domain reference (e.g. delivery id) echoed back to the UI.
    reference_id: Optional[str] = None
    #: 'origin' | 'stop' | 'destination' — assigned by the caller.
    role: str = "stop"


@dataclass(frozen=True)
class RouteGeometry:
    """Polyline geometry in GeoJSON coordinate order ([lng, lat])."""

    coordinates: list[list[float]]
    geometry_type: str = "LineString"

    def as_geojson(self) -> dict:
        return {"type": self.geometry_type, "coordinates": self.coordinates}


@dataclass(frozen=True)
class RouteLeg:
    distance_meters: float
    duration_seconds: float
    from_label: Optional[str] = None
    to_label: Optional[str] = None


@dataclass(frozen=True)
class RouteWaypoint:
    """A resolved waypoint, snapped to the road network where possible."""

    order: int
    role: str
    coordinates: Coordinates
    label: Optional[str] = None
    reference_id: Optional[str] = None
    snapped_name: Optional[str] = None


@dataclass(frozen=True)
class RouteBounds:
    min_latitude: float
    min_longitude: float
    max_latitude: float
    max_longitude: float


@dataclass(frozen=True)
class RouteResult:
    """Normalised routing response — identical across providers."""

    distance_meters: float
    duration_seconds: float
    geometry: RouteGeometry
    waypoints: list[RouteWaypoint] = field(default_factory=list)
    legs: list[RouteLeg] = field(default_factory=list)
    bounds: Optional[RouteBounds] = None
    provider: str = ""
    profile: str = ""

    @property
    def distance_km(self) -> float:
        return round(self.distance_meters / 1000.0, 3)

    @property
    def duration_minutes(self) -> float:
        return round(self.duration_seconds / 60.0, 1)

    @property
    def stop_count(self) -> int:
        return len(self.waypoints)


@dataclass(frozen=True)
class MatrixResult:
    """
    A full origin→destination travel matrix.

    Both grids are square and indexed by the position of each coordinate in the
    request. ``degraded`` is True when the matrix had to be assembled from
    individual route calls because the provider has no native table endpoint —
    the numbers are still real road distances, but they cost one call per pair.
    """

    distances_meters: list[list[float]]
    durations_seconds: list[list[float]]
    provider: str = ""
    profile: str = ""
    degraded: bool = False

    def __post_init__(self) -> None:
        size = len(self.distances_meters)
        if size != len(self.durations_seconds):
            raise ValueError("Matrix distance and duration grids must have the same size.")
        for row in self.distances_meters:
            if len(row) != size:
                raise ValueError("Matrix distance grid must be square.")
        for row in self.durations_seconds:
            if len(row) != size:
                raise ValueError("Matrix duration grid must be square.")

    def pair(self, origin: int, destination: int) -> tuple[float, float]:
        """(distance_meters, duration_seconds) for one origin/destination pair."""
        return self.distances_meters[origin][destination], self.durations_seconds[origin][destination]

    @property
    def max_duration_seconds(self) -> int:
        """Longest single leg in the matrix; used to bound solver dimensions."""
        return int(max((max(row) for row in self.durations_seconds), default=0))

    @property
    def max_distance_meters(self) -> float:
        return float(max((max(row) for row in self.distances_meters), default=0))


class RoutingService(ABC):
    """Contract every routing provider implementation must satisfy."""

    provider_id: str = "abstract"
    provider_name: str = "Abstract Routing Provider"
    requires_api_key: bool = False

    #: Whether this provider can answer a many-to-many matrix request natively.
    supports_matrix: bool = False

    @abstractmethod
    async def calculate_route(
        self,
        stops: Sequence[RouteStop],
        *,
        profile: Optional[str] = None,
    ) -> RouteResult:
        """
        Calculate a real road route through ``stops`` in the given order.

        Raises Provider* errors for transport failures, rate limits, timeouts,
        invalid input, and "no route found".
        """

    def describe(self) -> dict:
        """Provider metadata safe to expose to the frontend."""
        return {
            "provider": self.provider_id,
            "name": self.provider_name,
            "requires_api_key": self.requires_api_key,
            "configured": True,
            "supports_matrix": self.supports_matrix,
        }

    async def calculate_matrix(
        self,
        coordinates: Sequence[Coordinates],
        *,
        profile: Optional[str] = None,
    ) -> MatrixResult:
        """
        Build a full origin→destination travel matrix using real road data.

        Providers with a native table endpoint (e.g. OSRM) should override this
        and set ``supports_matrix = True``. Implementations that do not raise
        ``NotImplementedError``; callers may then fall back to pairwise
        ``calculate_route`` calls, which stays real but costs one request per pair.
        """
        raise NotImplementedError(
            f"Routing provider '{self.provider_id}' has no matrix endpoint."
        )
