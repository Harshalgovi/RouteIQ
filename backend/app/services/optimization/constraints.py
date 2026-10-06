"""
Eligibility rules, pre-flight validation and infeasibility diagnosis for the
optimisation engine.

Kept deliberately separate from the solver so that "why can this not be solved?"
is answered by ordinary Python that can be unit-tested without OR-Tools. The
solver is only ever handed inputs that already passed these checks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Sequence

from app.models.delivery import Delivery
from app.models.vehicle import Vehicle
from app.services.optimization.models import (
    Capacity,
    ConstraintViolation,
    DeliveryNode,
    InfeasibilityReason,
    ObjectiveWeights,
    OptimizationProblem,
    TimeWindow,
    VehicleNode,
    ViolationKind,
)
from app.services.geocoding.base import Coordinates

logger = logging.getLogger("routeiq.services.optimization.constraints")

# ─── Eligibility policies ─────────────────────────────────────────────────────

#: Deliveries in these states are finished/abandoned and must never be re-routed.
INELIGIBLE_DELIVERY_STATUSES = frozenset(
    {"delivered", "cancelled", "canceled", "returned", "failed"}
)

#: Deliveries eligible for a fresh routing decision.
ROUTABLE_DELIVERY_STATUSES = frozenset({"pending", "assigned", "delayed"})

#: Vehicle states that can take new work. Anything else is not dispatchable.
AVAILABLE_VEHICLE_STATUSES = frozenset({"available", "active"})

#: Drivers who cannot be dispatched.
AVAILABLE_DRIVER_STATUSES = frozenset({"active"})

#: Priority ordering used for the optional priority credit term.
PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}


class OptimizationInputError(Exception):
    """
    The request cannot be turned into a solvable problem.

    Carries a machine-readable ``reason`` plus operator-safe detail so the API
    layer never has to guess which HTTP status or wording applies.
    """

    def __init__(
        self,
        message: str,
        *,
        reason: InfeasibilityReason,
        violations: Optional[Sequence[ConstraintViolation]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason
        self.violations = list(violations or [])

    @property
    def user_message(self) -> str:
        return self.message


@dataclass(frozen=True)
class EligibilityReport:
    """What was filtered out and why — returned so nothing disappears silently."""

    routable_delivery_ids: list[int]
    skipped_delivery_ids: list[int]
    routable_vehicle_ids: list[int]
    skipped_vehicle_ids: list[int]
    notes: list[str]

    @property
    def has_any_routeable_vehicle(self) -> bool:
        return bool(self.routable_vehicle_ids)


# ─── Eligibility ──────────────────────────────────────────────────────────────


def delivery_is_routable(delivery: Delivery) -> bool:
    """A delivery may be re-routed only while it is still outstanding."""
    status = (delivery.status or "").strip().lower()
    return status not in INELIGIBLE_DELIVERY_STATUSES and delivery.status is not None


def vehicle_is_available(vehicle: Vehicle) -> bool:
    """A vehicle may take work only while it is dispatchable."""
    status = (vehicle.status or "").strip().lower()
    if status not in AVAILABLE_VEHICLE_STATUSES:
        return False
    if vehicle.driver is not None:
        driver_status = (vehicle.driver.status or "").strip().lower()
        if driver_status not in AVAILABLE_DRIVER_STATUSES:
            return False
    return True


def _time_window_for(delivery: Delivery) -> TimeWindow:
    return TimeWindow(start=delivery.time_window_start, end=delivery.time_window_end)


def coordinates_are_valid(coordinates: Coordinates) -> bool:
    """Bounds check applied by the engine itself, not delegated to the provider."""
    return (
        -90.0 <= coordinates.latitude <= 90.0
        and -180.0 <= coordinates.longitude <= 180.0
    )


def build_delivery_node(delivery: Delivery, *, service_seconds: float) -> Optional[DeliveryNode]:
    """
    Convert a Delivery row into a solver node.

    Returns None when the delivery has no usable coordinates — the caller
    reports those rather than dropping them silently.
    """
    if delivery.latitude is None or delivery.longitude is None:
        return None
    return DeliveryNode(
        delivery_id=delivery.id,
        tracking_number=delivery.tracking_number,
        customer_name=delivery.customer_name,
        address=delivery.address,
        coordinates=Coordinates(latitude=delivery.latitude, longitude=delivery.longitude),
        weight_kg=float(delivery.package_weight or 0.0),
        volume_m3=float(delivery.volume_m3 or 0.0),
        priority=(delivery.priority or "normal").strip().lower(),
        status=(delivery.status or "pending").strip().lower(),
        time_window=_time_window_for(delivery),
        service_seconds=service_seconds,
    )


def validate_coordinates(deliveries: Sequence[DeliveryNode], vehicles: Sequence[VehicleNode]) -> None:
    """
    Reject out-of-range coordinates before any provider call.

    Done here so a bad coordinate is reported identically regardless of which
    routing provider is configured — and so a lenient provider cannot quietly
    produce a nonsensical matrix.
    """
    # DeliveryNode exposes .coordinates; VehicleNode exposes .start / .end.
    offenders: list[tuple[str, Coordinates]] = [
        (d.tracking_number, d.coordinates)
        for d in deliveries
        if not coordinates_are_valid(d.coordinates)
    ]
    offenders += [
        (v.vehicle_number, v.start) for v in vehicles if not coordinates_are_valid(v.start)
    ]
    offenders += [
        (v.vehicle_number, v.end) for v in vehicles if not coordinates_are_valid(v.end)
    ]
    if not offenders:
        return

    shown = offenders[:5]
    detail = "; ".join(f"{name} ({c.latitude}, {c.longitude})" for name, c in shown)
    raise OptimizationInputError(
        f"Optimization could not run because {len(offenders)} location(s) have "
        f"coordinates outside valid bounds ({detail}). "
        "Latitude must be between -90 and 90, longitude between -180 and 180.",
        reason=InfeasibilityReason.INVALID_COORDINATES,
        violations=[
            ConstraintViolation(
                kind=ViolationKind.MISSING_COORDINATES,
                subject=name,
                message=(
                    f"Latitude {c.latitude}, longitude {c.longitude} is outside valid bounds."
                ),
            )
            for name, c in shown
        ],
    )


def build_vehicle_node(
    vehicle: Vehicle,
    *,
    use_current_position: bool,
    fallback_start: Optional[Coordinates] = None,
    available_from: Optional[datetime] = None,
    available_until: Optional[datetime] = None,
) -> Optional[VehicleNode]:
    """
    Convert a Vehicle row into a solver node.

    Returns None when the vehicle has no usable start position and no fallback
    was supplied.
    """
    start: Optional[Coordinates] = None
    if use_current_position and vehicle.current_latitude is not None and vehicle.current_longitude is not None:
        start = Coordinates(latitude=vehicle.current_latitude, longitude=vehicle.current_longitude)
    if start is None:
        start = fallback_start

    if start is None:
        return None

    return VehicleNode(
        vehicle_id=vehicle.id,
        vehicle_number=vehicle.vehicle_number,
        name=vehicle.name,
        capacity=Capacity(
            weight_kg=float(vehicle.capacity_kg or 0.0),
            volume_m3=float(vehicle.capacity_volume_m3 or 0.0),
        ),
        status=(vehicle.status or "available").strip().lower(),
        start=start,
        end=start,
        available_from=available_from,
        available_until=available_until,
        driver_id=vehicle.driver_id,
        driver_name=vehicle.driver.name if vehicle.driver is not None else None,
    )


def report_eligibility(
    deliveries: Sequence[Delivery],
    vehicles: Sequence[Vehicle],
    *,
    requested_delivery_ids: Optional[Sequence[int]],
    requested_vehicle_ids: Optional[Sequence[int]],
) -> EligibilityReport:
    """
    Decide which deliveries and vehicles take part, and explain every exclusion.

    An explicitly requested ID that is ineligible is reported as skipped — it is
    never silently optimised anyway.
    """
    notes: list[str] = []
    delivery_by_id = {d.id: d for d in deliveries}
    vehicle_by_id = {v.id: v for v in vehicles}

    if requested_delivery_ids:
        unknown = [i for i in requested_delivery_ids if i not in delivery_by_id]
        if unknown:
            raise OptimizationInputError(
                f"Unknown delivery id(s): {', '.join(str(i) for i in unknown)}.",
                reason=InfeasibilityReason.INVALID_DELIVERY_IDS,
            )
        selected = [delivery_by_id[i] for i in requested_delivery_ids]
    else:
        selected = list(deliveries)

    if requested_vehicle_ids:
        unknown = [i for i in requested_vehicle_ids if i not in vehicle_by_id]
        if unknown:
            raise OptimizationInputError(
                f"Unknown vehicle id(s): {', '.join(str(i) for i in unknown)}.",
                reason=InfeasibilityReason.INVALID_DELIVERY_IDS,
            )
        selected_vehicles = [vehicle_by_id[i] for i in requested_vehicle_ids]
    else:
        selected_vehicles = list(vehicles)

    routable_deliveries: list[Delivery] = []
    skipped_deliveries: list[Delivery] = []
    for delivery in selected:
        if delivery_is_routable(delivery):
            routable_deliveries.append(delivery)
        else:
            skipped_deliveries.append(delivery)

    routable_vehicles: list[Vehicle] = []
    skipped_vehicles: list[Vehicle] = []
    for vehicle in selected_vehicles:
        if vehicle_is_available(vehicle):
            routable_vehicles.append(vehicle)
        else:
            skipped_vehicles.append(vehicle)

    if skipped_deliveries:
        notes.append(
            f"{len(skipped_deliveries)} delivery/deliveries were excluded because they are "
            f"already delivered, cancelled or otherwise closed: "
            f"{', '.join(d.tracking_number for d in skipped_deliveries[:10])}"
            f"{' …' if len(skipped_deliveries) > 10 else ''}."
        )
    if skipped_vehicles:
        notes.append(
            f"{len(skipped_vehicles)} vehicle(s) were excluded because they are not available "
            f"or have no active driver: "
            f"{', '.join(v.vehicle_number for v in skipped_vehicles[:10])}"
            f"{' …' if len(skipped_vehicles) > 10 else ''}."
        )

    return EligibilityReport(
        routable_delivery_ids=[d.id for d in routable_deliveries],
        skipped_delivery_ids=[d.id for d in skipped_deliveries],
        routable_vehicle_ids=[v.id for v in routable_vehicles],
        skipped_vehicle_ids=[v.id for v in skipped_vehicles],
        notes=notes,
    )


# ─── Pre-flight validation ────────────────────────────────────────────────────


def check_capacity_feasibility(problem: OptimizationProblem) -> None:
    """
    Reject provably unsolvable capacity situations before calling the solver.

    Three distinct explanations are produced, because they need different fixes:
    one delivery that is too big for every van, not enough total weight across the
    fleet, and not enough total volume.
    """
    if not problem.deliveries or not problem.vehicles:
        return

    # A delivery heavier than the largest van can never be served, in any mode.
    largest = max(problem.deliveries, key=lambda d: d.weight_kg)
    best_kg = max((v.capacity.weight_kg for v in problem.vehicles), default=0.0)
    if best_kg > 0 and largest.weight_kg > best_kg + 1e-6:
        raise OptimizationInputError(
            f"Optimization could not find a feasible solution because delivery "
            f"{largest.tracking_number} weighs {largest.weight_kg:g} kg, which exceeds the "
            f"largest available vehicle capacity ({best_kg:g} kg).",
            reason=InfeasibilityReason.DELIVERY_EXCEEDS_CAPACITY,
            violations=[
                ConstraintViolation(
                    kind=ViolationKind.CAPACITY,
                    subject=largest.tracking_number,
                    delivery_id=largest.delivery_id,
                    message=(
                        f"{largest.weight_kg:g} kg required, {best_kg:g} kg available "
                        f"on the largest vehicle."
                    ),
                )
            ],
        )

    # In partial mode the caller explicitly accepts that some deliveries will be
    # left unserved, so insufficient *fleet* capacity is a valid answer rather
    # than an error: the solver returns the best subset it can serve.
    if problem.allow_partial:
        return

    if problem.total_capacity_kg > 0 and problem.total_demand_kg > problem.total_capacity_kg + 1e-6:
        raise OptimizationInputError(
            f"Optimization could not find a feasible solution because available vehicle "
            f"capacity is insufficient: {problem.total_demand_kg:g} kg of deliveries against "
            f"{problem.total_capacity_kg:g} kg of capacity across "
            f"{len(problem.vehicles)} available vehicle(s).",
            reason=InfeasibilityReason.INSUFFICIENT_CAPACITY,
            violations=[
                ConstraintViolation(
                    kind=ViolationKind.CAPACITY,
                    subject="fleet",
                    message=(
                        f"Total demand {problem.total_demand_kg:g} kg exceeds total capacity "
                        f"{problem.total_capacity_kg:g} kg."
                    ),
                )
            ],
        )

    if problem.total_capacity_m3 > 0 and problem.total_demand_m3 > problem.total_capacity_m3 + 1e-6:
        raise OptimizationInputError(
            f"Optimization could not find a feasible solution because available vehicle "
            f"volume is insufficient: {problem.total_demand_m3:g} m3 of deliveries against "
            f"{problem.total_capacity_m3:g} m3 of capacity across "
            f"{len(problem.vehicles)} available vehicle(s).",
            reason=InfeasibilityReason.INSUFFICIENT_CAPACITY,
            violations=[
                ConstraintViolation(
                    kind=ViolationKind.CAPACITY,
                    subject="fleet",
                    message=(
                        f"Total volume {problem.total_demand_m3:g} m3 exceeds total capacity "
                        f"{problem.total_capacity_m3:g} m3."
                    ),
                )
            ],
        )

def check_vehicle_availability_feasibility(problem: OptimizationProblem) -> None:
    """
    Reject vehicles whose availability window has already closed.

    Such a vehicle cannot reach a single stop, so silently ignoring it would
    produce a plan that quietly excludes a van the operator asked for. The
    caller supplied these windows explicitly, so the mismatch is reported.
    """
    reference = problem.reference_time
    expired = [
        vehicle
        for vehicle in problem.vehicles
        if vehicle.available_until is not None and vehicle.available_until <= reference
    ]
    if not expired:
        return

    listed = ", ".join(
        f"{v.vehicle_number} (available until {v.available_until.isoformat()})"  # type: ignore[union-attr]
        for v in expired[:5]
    )
    raise OptimizationInputError(
        f"Optimization could not run because {len(expired)} selected vehicle(s) "
        f"finish before the optimization reference time ({reference.isoformat()}): "
        f"{listed}. Use a reference time inside the shift, or widen the availability.",
        reason=InfeasibilityReason.CONSTRAINTS_CONFLICT,
        violations=[
            ConstraintViolation(
                kind=ViolationKind.TIME_WINDOW_END,
                subject=vehicle.vehicle_number,
                vehicle_id=vehicle.vehicle_id,
                message=(
                    f"Availability ends {vehicle.available_until.isoformat()}, "  # type: ignore[union-attr]
                    f"before the reference time {reference.isoformat()}."
                ),
            )
            for vehicle in expired
        ],
    )


def check_time_window_feasibility(problem: OptimizationProblem) -> None:
    """
    Reject windows that no vehicle could ever meet.

    Catches the two common dead ends cheaply: a window that already closed
    relative to the reference time, and a window whose start is later than the
    vehicle's own availability deadline.
    """
    reference = problem.reference_time
    impossible: list[ConstraintViolation] = []

    for delivery in problem.deliveries:
        window = delivery.time_window
        if window.end is not None and window.end < reference:
            impossible.append(
                ConstraintViolation(
                    kind=ViolationKind.TIME_WINDOW_END,
                    subject=delivery.tracking_number,
                    delivery_id=delivery.delivery_id,
                    message=(
                        f"Window closed at {window.end.isoformat()} which is before the "
                        f"optimization reference time {reference.isoformat()}."
                    ),
                )
            )
            continue

        if window.end is None or not problem.vehicles:
            continue

        # If the earliest a vehicle can leave is already after the window closes,
        # no schedule exists regardless of routing.
        for vehicle in problem.vehicles:
            if vehicle.available_until is None:
                continue
            if vehicle.available_from is not None and vehicle.available_from > window.end:
                impossible.append(
                    ConstraintViolation(
                        kind=ViolationKind.TIME_WINDOW_END,
                        subject=f"{delivery.tracking_number} / {vehicle.vehicle_number}",
                        delivery_id=delivery.delivery_id,
                        vehicle_id=vehicle.vehicle_id,
                        message=(
                            f"Vehicle is only available from "
                            f"{vehicle.available_from.isoformat()}, after the delivery window "
                            f"closes at {window.end.isoformat()}."
                        ),
                    )
                )
                break

    if impossible:
        subjects = ", ".join(sorted({v.subject for v in impossible})[:5])
        raise OptimizationInputError(
            "Route could not satisfy all delivery constraints: one or more delivery time "
            f"windows can no longer be met ({subjects}).",
            reason=InfeasibilityReason.IMPOSSIBLE_TIME_WINDOWS,
            violations=impossible,
        )


def build_default_objective() -> ObjectiveWeights:
    """v1 objective: minimise total travel distance, nothing else."""
    return ObjectiveWeights(distance_m=1.0)


def summarise_problem(problem: OptimizationProblem) -> str:
    """One-line, log-safe description of the problem handed to the solver."""
    return (
        f"{len(problem.deliveries)} deliveries / {problem.total_demand_kg:g} kg, "
        f"{len(problem.vehicles)} vehicles / {problem.total_capacity_kg:g} kg, "
        f"dimensions={','.join(problem.enforced_dimensions) or 'distance-only'}, "
        f"profile={problem.profile}"
    )


__all__ = [
    "AVAILABLE_DRIVER_STATUSES",
    "AVAILABLE_VEHICLE_STATUSES",
    "INELIGIBLE_DELIVERY_STATUSES",
    "PRIORITY_RANK",
    "ROUTABLE_DELIVERY_STATUSES",
    "EligibilityReport",
    "OptimizationInputError",
    "build_default_objective",
    "build_delivery_node",
    "build_vehicle_node",
    "check_capacity_feasibility",
    "check_time_window_feasibility",
    "check_vehicle_availability_feasibility",
    "coordinates_are_valid",
    "delivery_is_routable",
    "report_eligibility",
    "summarise_problem",
    "validate_coordinates",
    "vehicle_is_available",
]
