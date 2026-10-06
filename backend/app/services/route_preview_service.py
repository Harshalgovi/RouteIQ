"""
Route preview service — orchestration layer.

This is the only place that knows a route preview may require *both* geocoding
(address inputs) and routing (coordinates inputs). Endpoints call this service,
never a provider directly.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Sequence, Tuple

from app.schemas.route import (
    RouteBoundsResponse,
    RouteGeometryResponse,
    RouteLegResponse,
    RoutePreviewRequest,
    RoutePreviewResponse,
    RouteStopInput,
    RouteWaypointResponse,
)
from app.services.geocoding.base import Coordinates
from app.services.geocoding.registry import get_geocoding_service
from app.services.providers.errors import (
    InvalidLocationError,
    ProviderNotFoundError,
)
from app.services.routing.base import RouteStop
from app.services.routing.registry import get_routing_service

logger = logging.getLogger("routeiq.services.route_preview")


class RoutePreviewService:
    """Resolves locations, asks the routing provider, and shapes the response."""

    async def preview(self, request: RoutePreviewRequest) -> RoutePreviewResponse:
        routing_service = get_routing_service()
        geocoding_service = get_geocoding_service()

        # 1. Build the ordered waypoint list.
        ordered_inputs: List[Tuple[RouteStopInput, str]] = [(request.origin, "origin")]
        ordered_inputs.extend((stop, "stop") for stop in request.stops)
        ordered_inputs.append((request.destination, "destination"))

        geocoded_flags: List[bool] = []
        route_stops: List[RouteStop] = []

        for item, role in ordered_inputs:
            coordinates, was_geocoded = await self._resolve(
                item,
                role=role,
                geocoding_service=geocoding_service,
            )
            route_stops.append(
                RouteStop(
                    coordinates=coordinates,
                    label=item.label or self._default_label(item, role),
                    reference_id=self._reference_id(item),
                    role=role,
                )
            )
            geocoded_flags.append(was_geocoded)

        # 2. Real routing call against the configured provider.
        result = await routing_service.calculate_route(
            route_stops, profile=request.profile
        )

        # 3. Shape the provider-neutral result into the API contract.
        waypoints: List[RouteWaypointResponse] = []
        for index, waypoint in enumerate(result.waypoints):
            waypoints.append(
                RouteWaypointResponse(
                    order=waypoint.order,
                    role=waypoint.role,  # type: ignore[arg-type]
                    latitude=waypoint.coordinates.latitude,
                    longitude=waypoint.coordinates.longitude,
                    label=waypoint.label,
                    reference_id=waypoint.reference_id,
                    snapped_name=waypoint.snapped_name,
                    geocoded=geocoded_flags[index] if index < len(geocoded_flags) else False,
                )
            )

        legs = [
            RouteLegResponse(
                distance_meters=leg.distance_meters,
                distance_km=round(leg.distance_meters / 1000.0, 3),
                duration_seconds=leg.duration_seconds,
                duration_minutes=round(leg.duration_seconds / 60.0, 1),
                from_label=leg.from_label,
                to_label=leg.to_label,
            )
            for leg in result.legs
        ]

        bounds = None
        if result.bounds:
            bounds = RouteBoundsResponse(
                min_latitude=result.bounds.min_latitude,
                min_longitude=result.bounds.min_longitude,
                max_latitude=result.bounds.max_latitude,
                max_longitude=result.bounds.max_longitude,
            )

        return RoutePreviewResponse(
            provider=result.provider,
            profile=result.profile,
            distance_meters=round(result.distance_meters, 1),
            distance_km=result.distance_km,
            duration_seconds=round(result.duration_seconds, 1),
            duration_minutes=result.duration_minutes,
            geometry=RouteGeometryResponse(
                type="LineString",
                coordinates=[[round(lon, 6), round(lat, 6)] for lon, lat in result.geometry.coordinates],
            ),
            bounds=bounds,
            waypoints=waypoints,
            legs=legs,
            stop_count=len(request.stops),
            total_points=len(waypoints),
            computed_at=datetime.now(timezone.utc).isoformat(),
        )

    # -- Internals -----------------------------------------------------------

    async def _resolve(
        self,
        item: RouteStopInput,
        *,
        role: str,
        geocoding_service,
    ) -> tuple[Coordinates, bool]:
        if item.has_coordinates:
            return (
                Coordinates(latitude=float(item.latitude), longitude=float(item.longitude)),
                False,
            )

        address = (item.address or "").strip()
        if not address:
            raise InvalidLocationError(
                f"The {role} needs either coordinates or an address."
            )

        geocoded = await geocoding_service.geocode(address)
        if geocoded is None:
            raise ProviderNotFoundError(
                f"No coordinates could be found for the {role} address '{address}'. "
                "Check the address and try again, or pick the point directly on the map.",
                provider=geocoding_service.provider_id,
            )
        return geocoded.coordinates, True

    @staticmethod
    def _default_label(item: RouteStopInput, role: str) -> str:
        if item.address:
            return item.address
        if role == "origin":
            return "Origin"
        if role == "destination":
            return "Destination"
        return f"Stop {role}"

    @staticmethod
    def _reference_id(item: RouteStopInput) -> str | None:
        if item.delivery_id is not None:
            return f"delivery:{item.delivery_id}"
        if item.vehicle_id is not None:
            return f"vehicle:{item.vehicle_id}"
        return None


route_preview_service = RoutePreviewService()
