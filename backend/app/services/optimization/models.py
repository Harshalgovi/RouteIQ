"""
Solver-facing data model for the RouteIQ optimisation engine.

These are plain, provider-agnostic dataclasses: they describe *what has to be
solved*, not how. `optimizer.py` translates them into an OR-Tools model, and
`services/optimization/service.py` translates the answer back into the API
contract. Nothing here imports OR-Tools, which keeps the model unit-testable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Sequence

from app.services.geocoding.base import Coordinates
from app.services.routing.base import MatrixResult


class NodeKind(str, Enum):
    """What a matrix node represents."""

    DELIVERY = "delivery"
    VEHICLE_START = "vehicle_start"
    VEHICLE_END = "vehicle_end"


class OptimizationStatus(str, Enum):
    """Outcome of a solve. Only OPTIMAL/FEASIBLE/PARTIAL are successes."""

    OPTIMAL = "optimal"
    FEASIBLE = "feasible"
    PARTIAL = "partial"
    INFEASIBLE = "infeasible"


class InfeasibilityReason(str, Enum):
    """Why a solve could not produce a complete, valid plan."""

    NO_VEHICLES = "no_vehicles"
    NO_DELIVERIES = "no_deliveries"
    INVALID_DELIVERY_IDS = "invalid_delivery_ids"
    MISSING_COORDINATES = "missing_coordinates"
    INVALID_COORDINATES = "invalid_coordinates"
    MISSING_VEHICLE_POSITIONS = "missing_vehicle_positions"
    INSUFFICIENT_CAPACITY = "insufficient_capacity"
    DELIVERY_EXCEEDS_CAPACITY = "delivery_exceeds_capacity"
    IMPOSSIBLE_TIME_WINDOWS = "impossible_time_windows"
    NO_ROUTE_AVAILABLE = "no_route_available"
    CONSTRAINTS_CONFLICT = "constraints_conflict"


def to_naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """
    Normalise a datetime to timezone-naive UTC.

    The RouteIQ time-window columns are naive `DateTime`, so every instant that
    reaches the engine is converted to naive UTC first. Without this, a
    timezone-aware `reference_time` from an API client cannot be compared with a
    naive window read back from the database.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


class ViolationKind(str, Enum):
    """A specific broken constraint, reported instead of silently accepted."""

    CAPACITY = "capacity"
    TIME_WINDOW_END = "time_window_end"
    MISSING_COORDINATES = "missing_coordinates"


# ─── Problem inputs ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Capacity:
    """Vehicle capacity limits. Either dimension may be disabled with <= 0."""

    weight_kg: float
    volume_m3: float = 0.0

    @property
    def is_unbounded(self) -> bool:
        return self.weight_kg <= 0 and self.volume_m3 <= 0

    def allows(self, weight_kg: float, volume_m3: float) -> bool:
        if self.weight_kg > 0 and weight_kg > self.weight_kg + 1e-6:
            return False
        if self.volume_m3 > 0 and volume_m3 > self.volume_m3 + 1e-6:
            return False
        return True


@dataclass(frozen=True)
class TimeWindow:
    """Absolute service window. ``start`` may be None to mean "as early as possible"."""

    start: Optional[datetime]
    end: Optional[datetime]

    def __post_init__(self) -> None:
        # Normalise to naive UTC so windows read from the database (naive
        # DateTime) always compare against a naive reference time.
        object.__setattr__(self, "start", to_naive_utc(self.start))
        object.__setattr__(self, "end", to_naive_utc(self.end))
        if self.start is not None and self.end is not None and self.end < self.start:
            raise ValueError("A time window cannot end before it starts.")

    @property
    def is_flexible(self) -> bool:
        return self.start is None and self.end is None


@dataclass(frozen=True)
class OptimizationNode:
    """One point in the travel matrix."""

    key: str
    kind: NodeKind
    coordinates: Coordinates
    label: str
    #: Domain reference: delivery id, vehicle id, or "depot".
    reference_id: Optional[int] = None
    delivery_id: Optional[int] = None
    vehicle_id: Optional[int] = None


@dataclass(frozen=True)
class DeliveryNode:
    """A delivery eligible for routing."""

    delivery_id: int
    tracking_number: str
    customer_name: str
    address: str
    coordinates: Coordinates
    weight_kg: float
    volume_m3: float
    priority: str
    status: str
    time_window: TimeWindow
    service_seconds: float = 0.0


@dataclass(frozen=True)
class VehicleNode:
    """A vehicle eligible for routing."""

    vehicle_id: int
    vehicle_number: str
    name: str
    capacity: Capacity
    status: str
    start: Coordinates
    end: Coordinates
    #: Absolute time the vehicle may leave its start.
    available_from: Optional[datetime] = None
    #: Absolute time the vehicle must be back; None means no deadline.
    available_until: Optional[datetime] = None
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None

    def __post_init__(self) -> None:
        # See TimeWindow.__post_init__ — everything is normalised to naive UTC.
        object.__setattr__(self, "available_from", to_naive_utc(self.available_from))
        object.__setattr__(self, "available_until", to_naive_utc(self.available_until))


@dataclass(frozen=True)
class ObjectiveWeights:
    """
    Modularity hook for future cost terms.

    v1 minimises distance only. Adding fuel cost, driver-hours, traffic or
    vehicle operating cost later means adding a field here and one term in
    `optimizer.build_cost_callback` — no change to the solver plumbing.

    Every weight is in "equivalent metres", so a single integer arc cost keeps
    OR-Tools numerics stable regardless of which terms are enabled.
    """

    distance_m: float = 1.0
    duration_s: float = 0.0
    #: Metres of "credit" per delivery, by priority — rewards earlier service.
    priority_credit_m: float = 0.0
    priority_credits: dict[str, float] = field(
        default_factory=lambda: {"urgent": 0.0, "high": 0.0, "normal": 0.0, "low": 0.0}
    )

    @property
    def is_distance_only(self) -> bool:
        return (
            self.duration_s == 0.0
            and self.priority_credit_m == 0.0
            and not any(self.priority_credits.values())
        )


@dataclass
class OptimizationProblem:
    """The complete, validated input to the solver."""

    deliveries: list[DeliveryNode]
    vehicles: list[VehicleNode]
    profile: str = "driving"
    objective: ObjectiveWeights = field(default_factory=ObjectiveWeights)
    #: All times are measured relative to this instant. Kept timezone-naive
    #: (UTC) to match the naive DateTime columns in the database.
    reference_time: datetime = field(default_factory=lambda: datetime.utcnow())
    time_limit_seconds: float = 5.0
    #: Accept a plan that leaves deliveries unassigned instead of failing.
    allow_partial: bool = False
    #: Human-readable provenance, echoed in the response.
    routing_provider: str = ""
    matrix: Optional[MatrixResult] = None

    @property
    def total_demand_kg(self) -> float:
        return round(sum(d.weight_kg for d in self.deliveries), 3)

    @property
    def total_demand_m3(self) -> float:
        return round(sum(d.volume_m3 for d in self.deliveries), 3)

    @property
    def total_capacity_kg(self) -> float:
        return round(sum(v.capacity.weight_kg for v in self.vehicles if v.capacity.weight_kg > 0), 3)

    @property
    def total_capacity_m3(self) -> float:
        return round(sum(v.capacity.volume_m3 for v in self.vehicles if v.capacity.volume_m3 > 0), 3)

    @property
    def enforced_dimensions(self) -> list[str]:
        """Which resource dimensions the solver should activate."""
        dims: list[str] = []
        if any(v.capacity.weight_kg > 0 for v in self.vehicles):
            dims.append("weight_kg")
        if any(v.capacity.volume_m3 > 0 for v in self.vehicles):
            dims.append("volume_m3")
        if any(not d.time_window.is_flexible for d in self.deliveries):
            dims.append("time_windows")
        if any(v.available_until is not None for v in self.vehicles):
            dims.append("vehicle_availability")
        return dims


# ─── Solver outputs ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ScheduledStop:
    """A delivery placed on a vehicle's route, with its realised schedule."""

    sequence: int
    delivery_id: int
    tracking_number: str
    customer_name: str
    address: str
    coordinates: Coordinates
    priority: str
    arrival: datetime
    service_start: datetime
    service_end: datetime
    wait_seconds: float
    driving_seconds: float
    window_start: Optional[datetime]
    window_end: Optional[datetime]
    late_by_seconds: float = 0.0

    @property
    def is_late(self) -> bool:
        return self.late_by_seconds > 0.0


@dataclass
class VehicleRoute:
    """One vehicle's ordered route."""

    vehicle: VehicleNode
    stops: list[ScheduledStop]
    start: OptimizationNode
    end: OptimizationNode
    distance_meters: float
    duration_seconds: float
    capacity_used_kg: float
    capacity_used_m3: float
    return_time: Optional[datetime] = None
    total_wait_seconds: float = 0.0
    geometry: list[list[float]] = field(default_factory=list)
    bounds: Optional[list[float]] = None

    @property
    def delivery_count(self) -> int:
        return len(self.stops)

    @property
    def distance_km(self) -> float:
        return round(self.distance_meters / 1000.0, 3)

    @property
    def duration_minutes(self) -> float:
        return round(self.duration_seconds / 60.0, 1)


@dataclass(frozen=True)
class UnassignedDelivery:
    """A delivery that is eligible but could not be placed."""

    delivery_id: int
    tracking_number: str
    customer_name: str
    address: str
    priority: str
    weight_kg: float
    reason: str


@dataclass(frozen=True)
class ConstraintViolation:
    """A constraint the plan could not satisfy — surfaced, never swallowed."""

    kind: ViolationKind
    subject: str
    message: str
    delivery_id: Optional[int] = None
    vehicle_id: Optional[int] = None


@dataclass(frozen=True)
class SolverDiagnostics:
    """Where the answer came from and how hard the solver worked."""

    objective_value: float = 0.0
    wall_time_ms: int = 0
    iterations: int = 0
    vehicles_available: int = 0
    matrix_nodes: int = 0
    matrix_degraded: bool = False
    matrix_source: str = ""
    time_limit_seconds: float = 0.0


@dataclass
class OptimizationResult:
    """The solver's answer, before it is shaped into an API response."""

    status: OptimizationStatus
    routes: list[VehicleRoute] = field(default_factory=list)
    unassigned: list[UnassignedDelivery] = field(default_factory=list)
    violations: list[ConstraintViolation] = field(default_factory=list)
    diagnostics: SolverDiagnostics = field(default_factory=SolverDiagnostics)
    #: Populated when status is INFEASIBLE.
    reason: Optional[InfeasibilityReason] = None
    message: Optional[str] = None

    @property
    def is_success(self) -> bool:
        return self.status is not OptimizationStatus.INFEASIBLE

    @property
    def total_distance_meters(self) -> float:
        return round(sum(r.distance_meters for r in self.routes), 1)

    @property
    def total_duration_seconds(self) -> float:
        return round(sum(r.duration_seconds for r in self.routes), 1)

    @property
    def assigned_delivery_ids(self) -> list[int]:
        return [stop.delivery_id for route in self.routes for stop in route.stops]


@dataclass(frozen=True)
class BaselinePlan:
    """
    A clearly-defined "before" figure.

    Baseline = the deliveries in their existing database order, packed greedily
    into the same vehicles with no reordering, measured on the same real travel
    matrix. It is *not* a claim about what the fleet did before — the response
    labels it explicitly.
    """

    label: str
    description: str
    total_distance_meters: float
    total_duration_seconds: float
    vehicles_used: int

    @property
    def distance_km(self) -> float:
        return round(self.total_distance_meters / 1000.0, 3)

    @property
    def duration_minutes(self) -> float:
        return round(self.total_duration_seconds / 60.0, 1)


@dataclass(frozen=True)
class Comparison:
    """Before/after deltas. ``None`` savings mean "no baseline available"."""

    baseline: BaselinePlan
    optimized_distance_meters: float
    optimized_duration_seconds: float
    distance_saved_meters: float
    duration_saved_seconds: float
    distance_saved_percent: float

    @property
    def distance_saved_km(self) -> float:
        return round(self.distance_saved_meters / 1000.0, 3)

    @property
    def duration_saved_minutes(self) -> float:
        return round(self.duration_saved_seconds / 60.0, 1)


def order_stops_by_matrix(nodes: Sequence[OptimizationNode]) -> list[OptimizationNode]:
    """Deterministic node ordering: deliveries first, then vehicle endpoints."""
    return sorted(
        nodes,
        key=lambda n: (
            {NodeKind.DELIVERY: 0, NodeKind.VEHICLE_START: 1, NodeKind.VEHICLE_END: 2}[n.kind],
            n.reference_id if n.reference_id is not None else 0,
        ),
    )


__all__ = [
    "BaselinePlan",
    "Capacity",
    "Comparison",
    "ConstraintViolation",
    "DeliveryNode",
    "InfeasibilityReason",
    "NodeKind",
    "ObjectiveWeights",
    "OptimizationNode",
    "OptimizationProblem",
    "OptimizationResult",
    "OptimizationStatus",
    "ScheduledStop",
    "SolverDiagnostics",
    "TimeWindow",
    "UnassignedDelivery",
    "VehicleNode",
    "VehicleRoute",
    "ViolationKind",
    "order_stops_by_matrix",
    "to_naive_utc",
]
