"""
OSRM routing provider (OpenStreetMap-based, keyless demo server).

Uses the public OSRM HTTP API:
    GET /route/v1/{profile}/{lon,lat;lon,lat;...}
        ?overview=full&geometries=geojson&steps=false&annotations=false

The default router.project-osrm.org endpoint has no traffic awareness, which is
intentional for this phase — traffic-aware routing is a later phase.
"""

from __future__ import annotations

import logging
from typing import Optional, Sequence

from app.services.providers.cache import TTLCache
from app.services.providers.errors import (
    InvalidCoordinatesError,
    InvalidLocationError,
    ProviderBadResponseError,
    ProviderNotFoundError,
)
from app.services.providers.http import ProviderHttpClient
from app.services.routing.base import (
    MatrixResult,
    RouteBounds,
    RouteGeometry,
    RouteLeg,
    RouteResult,
    RoutingService,
    RouteStop,
    RouteWaypoint,
)

logger = logging.getLogger("routeiq.providers.routing.osrm")

SUPPORTED_PROFILES = ("driving", "walking", "cycling")


class OsrmRoutingService(RoutingService):
    provider_id = "osrm"
    provider_name = "OpenStreetMap OSRM"
    requires_api_key = False
    supports_matrix = True

    #: OSRM's public demo server accepts at most 100 coordinates per table
    #: request, so larger matrices are fetched in chunks using the
    #: ``sources`` / ``destinations`` index lists.
    MATRIX_CHUNK_SIZE = 100

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = 12.0,
        min_interval_seconds: float = 0.0,
        cache_ttl_seconds: int = 900,
        cache_max_entries: int = 1024,
        default_profile: str = "driving",
        api_key: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_profile = default_profile
        self._client = ProviderHttpClient(
            provider=self.provider_id,
            timeout_seconds=timeout_seconds,
            min_interval_seconds=min_interval_seconds,
            user_agent="RouteIQ/1.0 (delivery routing platform)",
        )
        self._cache: TTLCache[RouteResult] = TTLCache(
            max_entries=cache_max_entries, ttl_seconds=cache_ttl_seconds
        )
        self._matrix_cache: TTLCache[tuple[list[list[float]], list[list[float]]]] = TTLCache(
            max_entries=max(64, cache_max_entries // 4),
            ttl_seconds=cache_ttl_seconds,
        )

    # -- RoutingService ------------------------------------------------------

    async def calculate_route(
        self,
        stops: Sequence[RouteStop],
        *,
        profile: Optional[str] = None,
    ) -> RouteResult:
        if not stops or len(stops) < 2:
            raise InvalidLocationError(
                "A route needs at least an origin and a destination.", provider=self.provider_id
            )

        effective_profile = self._resolve_profile(profile)

        for stop in stops:
            lat, lon = stop.coordinates.as_tuple()
            if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
                raise InvalidCoordinatesError(provider=self.provider_id)

        coordinates_param = ";".join(
            f"{stop.coordinates.longitude:.6f},{stop.coordinates.latitude:.6f}" for stop in stops
        )
        params = {
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
            "annotations": "false",
            "alternatives": "false",
        }
        cache_key = f"{effective_profile}|{coordinates_param}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        url = f"{self.base_url}/route/v1/{effective_profile}/{coordinates_param}"
        # OSRM answers HTTP 400 with a structured body (e.g. {"code":"NoRoute"}),
        # so it is handled here rather than as a transport failure.
        payload = await self._client.get_json(
            url, params=params, accepted_statuses={200, 400}
        )
        result = self._parse(payload, stops=stops, profile=effective_profile)
        self._cache.set(cache_key, result)
        return result

    # -- Matrix --------------------------------------------------------------

    async def calculate_matrix(
        self,
        coordinates: Sequence[Coordinates],
        *,
        profile: Optional[str] = None,
    ) -> MatrixResult:
        """
        Real road distance/duration for every origin/destination pair.

        Uses the OSRM ``/table`` service, chunked so large problems stay inside
        the provider's coordinate limit.

        Every direction is fetched: one-way roads and turn restrictions make the
        grid asymmetric, so mirroring one half would invent distances that the
        provider never reported.
        """
        points = list(coordinates)
        if len(points) < 2:
            raise InvalidLocationError(
                "A travel matrix needs at least two locations.",
                provider=self.provider_id,
            )

        effective_profile = self._resolve_profile(profile)

        for stop in points:
            lat, lon = stop.as_tuple() if hasattr(stop, "as_tuple") else (stop.latitude, stop.longitude)
            if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
                raise InvalidCoordinatesError(provider=self.provider_id)

        size = len(points)
        coordinates_param = ";".join(f"{p.longitude:.6f},{p.latitude:.6f}" for p in points)

        distances: list[list[float]] = [[0.0] * size for _ in range(size)]
        durations: list[list[float]] = [[0.0] * size for _ in range(size)]

        chunk = self.MATRIX_CHUNK_SIZE
        for source_start in range(0, size, chunk):
            source_end = min(source_start + chunk, size)
            for dest_start in range(0, size, chunk):
                dest_end = min(dest_start + chunk, size)

                grid_distances, grid_durations = await self._fetch_matrix_chunk(
                    coordinates_param=coordinates_param,
                    sources=list(range(source_start, source_end)),
                    destinations=list(range(dest_start, dest_end)),
                    profile=effective_profile,
                )

                self._merge_matrix_chunk(
                    distances, durations, grid_distances, grid_durations,
                    source_start, dest_start,
                )

        return MatrixResult(
            distances_meters=distances,
            durations_seconds=durations,
            provider=self.provider_id,
            profile=effective_profile,
            degraded=False,
        )

    async def _fetch_matrix_chunk(
        self,
        *,
        coordinates_param: str,
        sources: list[int],
        destinations: list[int],
        profile: str,
    ) -> tuple[list[list[float]], list[list[float]]]:
        url = f"{self.base_url}/table/v1/{profile}/{coordinates_param}"
        params = {
            "annotations": "duration,distance",
            "sources": ";".join(str(i) for i in sources),
            "destinations": ";".join(str(i) for i in destinations),
        }
        cache_key = (
            f"table|{profile}|{coordinates_param}|{params['sources']}|{params['destinations']}"
        )
        cached = self._matrix_cache.get(cache_key)
        if cached is not None:
            return cached

        payload = await self._client.get_json(url, params=params, accepted_statuses={200, 400})
        if not isinstance(payload, dict) or payload.get("code") != "Ok":
            raise ProviderNotFoundError(
                "The routing provider could not build a travel matrix for these locations.",
                provider=self.provider_id,
            )

        raw_distances = payload.get("distances")
        raw_durations = payload.get("durations")
        if not isinstance(raw_distances, list) or not isinstance(raw_durations, list):
            raise ProviderBadResponseError(
                "The routing provider returned an unusable travel matrix.",
                provider=self.provider_id,
            )

        rows = len(sources)
        cols = len(destinations)
        grid_distances = self._coerce_grid(raw_distances, rows, cols, self.provider_id)
        grid_durations = self._coerce_grid(raw_durations, rows, cols, self.provider_id)

        self._matrix_cache.set(cache_key, (grid_distances, grid_durations))
        return grid_distances, grid_durations

    @staticmethod
    def _coerce_grid(raw: list, rows: int, cols: int, provider: str) -> list[list[float]]:
        if len(raw) != rows or any(not isinstance(row, list) or len(row) != cols for row in raw):
            raise ProviderBadResponseError(
                "The routing provider returned an unusable travel matrix.",
                provider=provider,
            )
        grid: list[list[float]] = []
        for row in raw:
            converted: list[float] = []
            for value in row:
                # OSRM emits null for origin/destination pairs it cannot connect.
                # Turning that into a 0 m hop would produce an impossibly cheap —
                # and therefore invalid — route, so it is reported instead.
                if value is None:
                    raise ProviderNotFoundError(
                        "No drivable route was found between some of the selected locations.",
                        provider=provider,
                    )
                try:
                    converted.append(float(value))
                except (TypeError, ValueError) as exc:
                    raise ProviderBadResponseError(
                        "The routing provider returned an unusable travel matrix.",
                        provider=provider,
                    ) from exc
            grid.append(converted)
        return grid

    @staticmethod
    def _merge_matrix_chunk(
        distances: list[list[float]],
        durations: list[list[float]],
        grid_distances: list[list[float]],
        grid_durations: list[list[float]],
        source_start: int,
        dest_start: int,
    ) -> None:
        for row_index, source in enumerate(range(source_start, source_start + len(grid_distances))):
            for col_index, dest in enumerate(range(dest_start, dest_start + len(grid_distances[0]))):
                distances[source][dest] = grid_distances[row_index][col_index]
                durations[source][dest] = grid_durations[row_index][col_index]

    def _resolve_profile(self, profile: Optional[str]) -> str:
        effective = (profile or self.default_profile or "driving").strip().lower()
        if effective not in SUPPORTED_PROFILES:
            raise InvalidLocationError(
                f"Unsupported routing profile '{effective}'. "
                f"Supported profiles: {', '.join(SUPPORTED_PROFILES)}.",
                provider=self.provider_id,
            )
        return effective

    # -- Internals -----------------------------------------------------------

    def _parse(self, payload: object, *, stops: Sequence[RouteStop], profile: str) -> RouteResult:
        if not isinstance(payload, dict):
            raise ProviderBadResponseError(provider=self.provider_id)

        code = payload.get("code")
        if code == "NoRoute":
            raise ProviderNotFoundError(
                "No drivable route was found between the selected locations.",
                provider=self.provider_id,
            )
        if code != "Ok":
            message = payload.get("message")
            logger.info("[osrm] route not available: %s", code or "unknown")
            raise ProviderNotFoundError(
                "The routing provider could not build a route between these locations.",
                provider=self.provider_id,
            )

        routes = payload.get("routes")
        if not isinstance(routes, list) or not routes:
            raise ProviderNotFoundError(
                "The routing provider returned no route for these locations.",
                provider=self.provider_id,
            )

        route = routes[0]
        if not isinstance(route, dict):
            raise ProviderBadResponseError(provider=self.provider_id)

        try:
            distance_meters = float(route.get("distance") or 0.0)
            duration_seconds = float(route.get("duration") or 0.0)
        except (TypeError, ValueError) as exc:
            raise ProviderBadResponseError(provider=self.provider_id) from exc

        geometry = self._parse_geometry(route.get("geometry"))
        bounds = self._parse_bounds(route.get("bbox"))
        waypoints = self._parse_waypoints(payload.get("waypoints"), stops)
        legs = self._parse_legs(route.get("legs"), stops)

        return RouteResult(
            distance_meters=distance_meters,
            duration_seconds=duration_seconds,
            geometry=geometry,
            waypoints=waypoints,
            legs=legs,
            bounds=bounds,
            provider=self.provider_id,
            profile=profile,
        )

    def _parse_geometry(self, raw: object) -> RouteGeometry:
        if not isinstance(raw, dict):
            raise ProviderBadResponseError(
                "The routing provider returned no route geometry.", provider=self.provider_id
            )
        coordinates = raw.get("coordinates")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ProviderBadResponseError(
                "The routing provider returned an unusable route geometry.",
                provider=self.provider_id,
            )
        cleaned: list[list[float]] = []
        for point in coordinates:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                cleaned.append([float(point[0]), float(point[1])])
            except (TypeError, ValueError):
                continue
        if len(cleaned) < 2:
            raise ProviderBadResponseError(
                "The routing provider returned an unusable route geometry.",
                provider=self.provider_id,
            )
        return RouteGeometry(coordinates=cleaned)

    def _parse_bounds(self, raw: object) -> Optional[RouteBounds]:
        if not isinstance(raw, (list, tuple)) or len(raw) != 4:
            return None
        try:
            min_lon, min_lat, max_lon, max_lat = (float(v) for v in raw)
        except (TypeError, ValueError):
            return None
        return RouteBounds(
            min_latitude=min_lat,
            min_longitude=min_lon,
            max_latitude=max_lat,
            max_longitude=max_lon,
        )

    def _parse_waypoints(
        self, raw: object, stops: Sequence[RouteStop]
    ) -> list[RouteWaypoint]:
        resolved: list[RouteWaypoint] = []
        raw_points = raw if isinstance(raw, list) else []

        for index, stop in enumerate(stops):
            snapped = None
            if index < len(raw_points) and isinstance(raw_points[index], dict):
                location = raw_points[index].get("location")
                if isinstance(location, (list, tuple)) and len(location) >= 2:
                    try:
                        snapped = (float(location[1]), float(location[0]))  # (lat, lng)
                    except (TypeError, ValueError):
                        snapped = None
                name = raw_points[index].get("name")
            else:
                name = None

            lat, lon = snapped if snapped else stop.coordinates.as_tuple()
            resolved.append(
                RouteWaypoint(
                    order=index,
                    role=stop.role,
                    coordinates=stop.coordinates.__class__(latitude=lat, longitude=lon),
                    label=stop.label,
                    reference_id=stop.reference_id,
                    snapped_name=name if isinstance(name, str) and name else None,
                )
            )
        return resolved

    def _parse_legs(self, raw: object, stops: Sequence[RouteStop]) -> list[RouteLeg]:
        legs: list[RouteLeg] = []
        raw_legs = raw if isinstance(raw, list) else []

        for index, leg in enumerate(raw_legs):
            if not isinstance(leg, dict):
                continue
            try:
                distance = float(leg.get("distance") or 0.0)
                duration = float(leg.get("duration") or 0.0)
            except (TypeError, ValueError):
                continue
            from_label = stops[index].label if index < len(stops) else None
            to_label = stops[index + 1].label if index + 1 < len(stops) else None
            legs.append(
                RouteLeg(
                    distance_meters=distance,
                    duration_seconds=duration,
                    from_label=from_label,
                    to_label=to_label,
                )
            )
        return legs
