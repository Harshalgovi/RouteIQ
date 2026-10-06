"""
Deterministic fake geocoding / routing providers for the test suite.

Fixtures live in tests/conftest.py; this module only holds the fakes themselves.
"""

from typing import List, Optional

from app.services.geocoding.base import Coordinates, GeocodeResult, GeocodingService
from app.services.routing.base import (
    MatrixResult,
    RouteGeometry,
    RouteResult,
    RoutingService,
    RouteStop,
)


class FakeGeocodingService(GeocodingService):
    """Deterministic geocoder: maps known addresses to fixed coordinates."""

    provider_id = "fake"
    provider_name = "Fake Geocoder"
    requires_api_key = False

    KNOWN = {
        "120 s wacker dr, chicago, il 60606": (41.880216, -87.636747),
        "600 n michigan ave, chicago, il 60611": (41.891700, -87.624300),
        "400 n halsted st, chicago, il 60642": (41.889300, -87.647400),
        "850 n clark st, chicago, il 60610": (41.898400, -87.631200),
    }

    def __init__(self) -> None:
        self.calls: List[str] = []

    async def geocode(
        self,
        address: str,
        *,
        country_codes: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Optional[GeocodeResult]:
        self.calls.append(address)
        coords = self.KNOWN.get(address.strip().lower())
        if coords is None:
            return None
        return GeocodeResult(
            coordinates=Coordinates(latitude=coords[0], longitude=coords[1]),
            formatted_address=address,
            display_name=address,
            provider=self.provider_id,
        )

    async def reverse_geocode(self, coordinates: Coordinates) -> Optional[str]:
        return f"{coordinates.latitude:.4f}, {coordinates.longitude:.4f} (fake reverse lookup)"


class FakeRoutingService(RoutingService):
    """
    Deterministic router with a real distance/time model.

    Costs are derived from great-circle distance with a fixed road-winding
    factor and a constant average speed, so matrices are internally consistent
    (a matrix leg equals a route leg between the same pair) and a better
    ordering genuinely produces a lower total. That makes capacity, time-window
    and multi-vehicle assertions meaningful instead of tautological.
    """

    provider_id = "fake"
    provider_name = "Fake Router"
    requires_api_key = False
    supports_matrix = True

    #: Multiplies great-circle distance to approximate real road winding.
    ROAD_FACTOR = 1.3
    #: Metres per second, used to derive durations from distances.
    SPEED_MPS = 8.333  # ~30 km/h urban

    def __init__(self, *, distance_meters: float = 5000.0, duration_seconds: float = 600.0) -> None:
        self.distance_meters = distance_meters
        self.duration_seconds = duration_seconds
        self.calls: List[tuple] = []
        self.matrix_calls: List[tuple] = []
        self.fail_with: Optional[Exception] = None

    # -- helpers -------------------------------------------------------------

    @classmethod
    def _road_distance(cls, a: Coordinates, b: Coordinates) -> float:
        from math import asin, cos, radians, sin, sqrt

        radius = 6371000.0
        lat1, lat2 = radians(a.latitude), radians(b.latitude)
        dlat = lat2 - lat1
        dlon = radians(b.longitude - a.longitude)
        h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        return 2 * radius * asin(sqrt(h)) * cls.ROAD_FACTOR

    def _pair(self, a: Coordinates, b: Coordinates) -> tuple[float, float]:
        distance = self._road_distance(a, b)
        return distance, distance / self.SPEED_MPS

    # -- RoutingService ------------------------------------------------------

    async def calculate_matrix(
        self, coordinates, *, profile: Optional[str] = None
    ) -> MatrixResult:
        self.matrix_calls.append((tuple(coordinates), profile))
        if self.fail_with is not None:
            raise self.fail_with

        points = list(coordinates)
        size = len(points)
        distances: List[List[float]] = []
        durations: List[List[float]] = []
        for i in range(size):
            distance_row: List[float] = []
            duration_row: List[float] = []
            for j in range(size):
                if i == j:
                    distance_row.append(0.0)
                    duration_row.append(0.0)
                    continue
                distance, duration = self._pair(points[i], points[j])
                distance_row.append(distance)
                duration_row.append(duration)
            distances.append(distance_row)
            durations.append(duration_row)

        return MatrixResult(
            distances_meters=distances,
            durations_seconds=durations,
            provider=self.provider_id,
            profile=profile or "driving",
            degraded=False,
        )

    async def calculate_route(
        self, stops, *, profile: Optional[str] = None
    ) -> RouteResult:
        self.calls.append((tuple(stops), profile))
        if self.fail_with is not None:
            raise self.fail_with

        coordinates: List[List[float]] = []
        waypoints = []
        for index, stop in enumerate(stops):
            lat, lon = stop.coordinates.as_tuple()
            coordinates.append([lon, lat])
            waypoints.append(stop)

        # Real per-pair costs so matrix and route answers agree.
        total_distance = 0.0
        total_duration = 0.0
        legs = []
        for index in range(len(stops) - 1):
            distance, duration = self._pair(
                stops[index].coordinates, stops[index + 1].coordinates
            )
            total_distance += distance
            total_duration += duration
            legs.append(
                self._leg(distance, duration, stops[index].label, stops[index + 1].label)
            )

        lats = [c[1] for c in coordinates]
        lons = [c[0] for c in coordinates]

        return RouteResult(
            distance_meters=total_distance,
            duration_seconds=total_duration,
            geometry=RouteGeometry(coordinates=coordinates),
            waypoints=[
                self._waypoint(index, stop) for index, stop in enumerate(waypoints)
            ],
            legs=legs,
            bounds=self._bounds(min(lats), min(lons), max(lats), max(lons)),
            provider=self.provider_id,
            profile=profile or "driving",
        )

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _leg(distance_meters, duration_seconds, from_label, to_label):
        from app.services.routing.base import RouteLeg

        return RouteLeg(
            distance_meters=distance_meters,
            duration_seconds=duration_seconds,
            from_label=from_label,
            to_label=to_label,
        )

    @staticmethod
    def _waypoint(index, stop: RouteStop):
        from app.services.routing.base import RouteWaypoint

        return RouteWaypoint(
            order=index,
            role=stop.role,
            coordinates=stop.coordinates,
            label=stop.label,
            reference_id=stop.reference_id,
            snapped_name=stop.label,
        )

    @staticmethod
    def _bounds(min_lat, min_lon, max_lat, max_lon):
        from app.services.routing.base import RouteBounds

        return RouteBounds(
            min_latitude=min_lat,
            min_longitude=min_lon,
            max_latitude=max_lat,
            max_longitude=max_lon,
        )
