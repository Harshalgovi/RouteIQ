"""
Pydantic schemas for route preview requests and responses.
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.providers.errors import InvalidCoordinatesError


class RouteStopInput(BaseModel):
    """
    A single route waypoint.

    Either supply coordinates, or an address that the backend geocodes.
    """

    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    address: Optional[str] = None
    label: Optional[str] = None
    delivery_id: Optional[int] = None
    vehicle_id: Optional[int] = None

    @model_validator(mode="after")
    def ensure_coordinates_or_address(self) -> "RouteStopInput":
        has_coords = self.latitude is not None and self.longitude is not None
        has_address = bool(self.address and self.address.strip())
        if not has_coords and not has_address:
            raise ValueError(
                "Each location needs either latitude/longitude or an address."
            )
        if self.latitude is None and self.longitude is not None:
            raise ValueError("longitude requires latitude.")
        if self.longitude is None and self.latitude is not None:
            raise ValueError("latitude requires longitude.")
        return self

    @property
    def coordinates_or_none(self) -> Optional[tuple[float, float]]:
        if self.latitude is not None and self.longitude is not None:
            return (self.latitude, self.longitude)
        return None

    @property
    def has_coordinates(self) -> bool:
        return self.latitude is not None and self.longitude is not None


class RoutePreviewRequest(BaseModel):
    """
    Real routing request.

    NOTE: this phase calculates and displays a route preview only.
    Stop *ordering* is supplied by the caller — no optimisation is performed.
    """

    origin: RouteStopInput
    destination: RouteStopInput
    # Optional intermediate stops, visited in the order provided.
    stops: List[RouteStopInput] = Field(default_factory=list)
    profile: Literal["driving", "walking", "cycling"] = "driving"

    @model_validator(mode="after")
    def limit_stops(self) -> "RoutePreviewRequest":
        if len(self.stops) > 25:
            raise ValueError("A route preview supports at most 25 intermediate stops.")
        return self


class RouteWaypointResponse(BaseModel):
    order: int
    role: Literal["origin", "stop", "destination"]
    latitude: float
    longitude: float
    label: Optional[str] = None
    reference_id: Optional[str] = None
    snapped_name: Optional[str] = None
    geocoded: bool = Field(
        default=False,
        description="True when the coordinates were resolved from an address by the backend.",
    )


class RouteLegResponse(BaseModel):
    distance_meters: float
    distance_km: float
    duration_seconds: float
    duration_minutes: float
    from_label: Optional[str] = None
    to_label: Optional[str] = None


class RouteGeometryResponse(BaseModel):
    type: Literal["LineString"] = "LineString"
    # GeoJSON coordinate order: [longitude, latitude]
    coordinates: List[List[float]]


class RouteBoundsResponse(BaseModel):
    min_latitude: float
    min_longitude: float
    max_latitude: float
    max_longitude: float


class RoutePreviewResponse(BaseModel):
    """
    Real routing result from the configured routing provider.
    """

    provider: str
    profile: str
    distance_meters: float
    distance_km: float
    duration_seconds: float
    duration_minutes: float
    geometry: RouteGeometryResponse
    bounds: Optional[RouteBoundsResponse] = None
    waypoints: List[RouteWaypointResponse]
    legs: List[RouteLegResponse] = Field(default_factory=list)
    stop_count: int = Field(
        description="Number of intermediate stops (excludes origin and destination)."
    )
    total_points: int = Field(
        description="Number of waypoints including origin and destination."
    )
    computed_at: str

    model_config = ConfigDict(from_attributes=True)


__all__ = [
    "InvalidCoordinatesError",
    "RouteBoundsResponse",
    "RouteGeometryResponse",
    "RouteLegResponse",
    "RoutePreviewRequest",
    "RoutePreviewResponse",
    "RouteStopInput",
    "RouteWaypointResponse",
]
