"""
Pydantic schemas for the route optimisation API.

The request mirrors the operator's intent ("optimise these deliveries with these
vehicles, under these preferences"); the response is a complete, honest report —
including the parts that failed.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.optimization.models import ObjectiveWeights

OptimizationProfile = Literal["driving", "walking", "cycling"]


class ObjectiveWeightsRequest(BaseModel):
    """
    Cost weights for the objective, all expressed in "equivalent metres".

    The default is distance only. Supplying any other term switches the objective
    on; adding a new term in a later phase means adding a field here and one term
    in the cost callback.
    """

    distance_m: float = Field(default=1.0, ge=0.0, description="Metres travelled (default 1.0).")
    duration_s: float = Field(default=0.0, ge=0.0, description="Seconds travelled.")
    priority_credit_m: float = Field(
        default=0.0,
        ge=0.0,
        description="Metres of credit per unit of priority, to reward earlier service.",
    )
    priority_credits: dict[str, float] = Field(
        default_factory=lambda: {"urgent": 0.0, "high": 0.0, "normal": 0.0, "low": 0.0}
    )

    def to_domain(self) -> ObjectiveWeights:
        return ObjectiveWeights(
            distance_m=self.distance_m,
            duration_s=self.duration_s,
            priority_credit_m=self.priority_credit_m,
            priority_credits=dict(self.priority_credits),
        )


class OptimizationPreferencesRequest(BaseModel):
    """Operator preferences. Every field has a safe default."""

    use_current_vehicle_positions: bool = Field(
        default=True,
        description="Start each route from the vehicle's last recorded position.",
    )
    depot_latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    depot_longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    service_seconds_per_delivery: float = Field(
        default=600.0, ge=0.0, le=7200.0, description="Dwell time at each delivery."
    )
    shift_start: Optional[datetime] = Field(
        default=None, description="Earliest any vehicle may leave. Defaults to now."
    )
    shift_end: Optional[datetime] = Field(
        default=None, description="Latest any vehicle must be back at its end."
    )
    reference_time: Optional[datetime] = Field(
        default=None,
        description="Instant that schedules are relative to. Defaults to shift_start or now.",
    )
    allow_partial: bool = Field(
        default=False,
        description=(
            "Permit a plan that leaves deliveries unassigned instead of failing. "
            "Unassigned deliveries are always reported."
        ),
    )
    allow_pairwise_fallback: bool = Field(
        default=True,
        description="Allow building the matrix from individual routes when the provider "
        "has no table endpoint.",
    )
    time_limit_seconds: float = Field(
        default=5.0, gt=0.0, le=60.0, description="Solver wall-clock budget."
    )
    objective: Optional[ObjectiveWeightsRequest] = None

    @model_validator(mode="after")
    def require_both_depot_coordinates(self) -> "OptimizationPreferencesRequest":
        if (self.depot_latitude is None) != (self.depot_longitude is None):
            raise ValueError("depot_latitude and depot_longitude must be supplied together.")
        return self

    @model_validator(mode="after")
    def validate_shift(self) -> "OptimizationPreferencesRequest":
        if self.shift_start and self.shift_end and self.shift_end <= self.shift_start:
            raise ValueError("shift_end must be after shift_start.")
        return self


class OptimizationRequest(BaseModel):
    """
    Optimise a set of real deliveries across real vehicles.

    Omitting ``delivery_ids`` optimises every routable delivery; omitting
    ``vehicle_ids`` considers every available vehicle.
    """

    delivery_ids: Optional[List[int]] = Field(
        default=None, description="Deliveries to route. Omit for all routable deliveries."
    )
    vehicle_ids: Optional[List[int]] = Field(
        default=None, description="Vehicles to route with. Omit for all available vehicles."
    )
    profile: OptimizationProfile = "driving"
    preferences: Optional[OptimizationPreferencesRequest] = None
    optimization_id: Optional[str] = Field(
        default=None, max_length=64, description="Caller-supplied correlation id."
    )

    @model_validator(mode="after")
    def reject_empty_selections(self) -> "OptimizationRequest":
        if self.delivery_ids is not None and len(self.delivery_ids) == 0:
            raise ValueError(
                "delivery_ids was supplied but empty — omit the field to optimise every "
                "routable delivery."
            )
        if self.vehicle_ids is not None and len(self.vehicle_ids) == 0:
            raise ValueError(
                "vehicle_ids was supplied but empty — omit the field to use every available vehicle."
            )
        return self


# ─── Response ─────────────────────────────────────────────────────────────────


class RouteEndpointResponse(BaseModel):
    label: str
    latitude: float
    longitude: float


class OptimizedStopResponse(BaseModel):
    sequence: int = Field(description="1-based position of this stop on its vehicle's route.")
    delivery_id: int
    tracking_number: str
    customer_name: str
    address: str
    latitude: float
    longitude: float
    priority: str
    arrival: str
    service_start: str
    service_end: str
    estimated_arrival: str = Field(description="When service is expected to begin.")
    wait_seconds: float = Field(description="Idle time spent waiting for the window to open.")
    driving_seconds: float
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    within_window: bool
    late_by_seconds: float = 0.0


class CapacityUsageResponse(BaseModel):
    capacity_kg: float
    used_kg: float
    remaining_kg: Optional[float] = None
    utilization_percent: Optional[float] = None
    capacity_volume_m3: float = 0.0
    used_volume_m3: float = 0.0
    remaining_volume_m3: Optional[float] = None


class VehicleRouteResponse(BaseModel):
    vehicle_id: int
    vehicle_number: str
    vehicle_name: str
    vehicle_status: str
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None
    start: RouteEndpointResponse
    end: RouteEndpointResponse
    stops: List[OptimizedStopResponse]
    stop_count: int
    distance_meters: float
    distance_km: float
    duration_seconds: float
    duration_minutes: float
    driving_seconds: float = Field(description="Elapsed time excluding waiting.")
    waiting_seconds: float
    estimated_return: Optional[str] = None
    capacity: CapacityUsageResponse
    has_time_window_violations: bool = False
    #: Real road polyline as [latitude, longitude] pairs, ready for Leaflet. Empty
    #: only when no geometry could be resolved from the routing provider.
    geometry: List[List[float]] = Field(default_factory=list)
    #: [south, west, north, east] for fitting the map to this route alone.
    bounds: Optional[List[float]] = None


class UnassignedDeliveryResponse(BaseModel):
    delivery_id: int
    tracking_number: str
    customer_name: str
    address: str
    priority: str
    weight_kg: float
    reason: str


class ConstraintViolationResponse(BaseModel):
    kind: Literal["capacity", "time_window_end", "missing_coordinates"] | str
    subject: str
    message: str
    delivery_id: Optional[int] = None
    vehicle_id: Optional[int] = None


class OptimizationSummaryResponse(BaseModel):
    total_distance_meters: float
    total_distance_km: float
    total_duration_seconds: float
    total_duration_minutes: float
    vehicles_available: int
    vehicles_used: int
    deliveries_eligible: int
    deliveries_assigned: int
    deliveries_unassigned: int
    total_demand_kg: float
    total_demand_m3: float
    total_capacity_kg: float
    total_capacity_m3: float
    constraints_enforced: List[str] = Field(default_factory=list)


class BaselineResponse(BaseModel):
    label: str
    description: str
    total_distance_meters: float
    distance_km: float
    total_duration_seconds: float
    duration_minutes: float
    vehicles_used: int


class BaselineComparisonResponse(BaseModel):
    """Before/after, against an explicitly-labelled baseline."""

    baseline: BaselineResponse
    optimized_distance_meters: float
    optimized_distance_km: float
    optimized_duration_seconds: float
    optimized_duration_minutes: float
    distance_saved_meters: float
    distance_saved_km: float
    duration_saved_seconds: float
    duration_saved_minutes: float
    distance_saved_percent: float


class SolverDiagnosticsResponse(BaseModel):
    objective_value: float
    wall_time_ms: int
    vehicles_available: int
    matrix_nodes: int
    matrix_source: str
    matrix_degraded: bool = Field(
        description="True when the matrix was assembled from individual routes."
    )
    time_limit_seconds: float
    enforced_constraints: List[str] = Field(default_factory=list)
    objective: str = "minimize_total_travel_distance"


class OptimizationResponse(BaseModel):
    optimization_id: str
    status: Literal["optimal", "feasible", "partial", "infeasible"]
    message: Optional[str] = Field(
        default=None, description="Operator-facing explanation, especially when infeasible."
    )
    provider: str
    profile: str
    summary: OptimizationSummaryResponse
    routes: List[VehicleRouteResponse] = Field(default_factory=list)
    unassigned: List[UnassignedDeliveryResponse] = Field(default_factory=list)
    violations: List[ConstraintViolationResponse] = Field(default_factory=list)
    baseline: Optional[BaselineComparisonResponse] = None
    solver: SolverDiagnosticsResponse
    warnings: List[str] = Field(default_factory=list)
    computed_at: str

    model_config = ConfigDict(from_attributes=True)


__all__ = [
    "BaselineComparisonResponse",
    "BaselineResponse",
    "CapacityUsageResponse",
    "ConstraintViolationResponse",
    "ObjectiveWeightsRequest",
    "OptimizationPreferencesRequest",
    "OptimizationRequest",
    "OptimizationResponse",
    "OptimizationSummaryResponse",
    "OptimizedStopResponse",
    "RouteEndpointResponse",
    "SolverDiagnosticsResponse",
    "UnassignedDeliveryResponse",
    "VehicleRouteResponse",
]
