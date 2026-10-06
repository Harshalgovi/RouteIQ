"""
OR-Tools vehicle routing solver for RouteIQ.

This module owns exactly one responsibility: turn an `OptimizationProblem` into
an `OptimizationResult` using Google OR-Tools. It performs no I/O of its own —
the travel matrix is handed to it pre-built (see `matrix.py`) — so the solver can
be exercised in tests without any provider.

Modelled constraints (v1):
  * Vehicle capacity (weight and/or volume), per vehicle.
  * Delivery time windows, with waiting allowed before service.
  * Vehicle availability (earliest departure / return deadline).
  * Every eligible delivery is served exactly once, unless the caller explicitly
    allows a partial plan — in which case unassigned deliveries are reported.

Objective (v1): minimise total travel distance. The arc-cost function is built by
`build_cost_callback` from `ObjectiveWeights`, which is the single place to add
fuel cost, driver hours, traffic or vehicle operating cost later.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

# OR-Tools ships a large native wheel. Some serverless hosts cannot install or
# load it, and a top-level import failure here would abort the whole application
# at startup — every endpoint, including /health, would 500. Import it defensively
# so the rest of the API stays up and only route optimisation reports unavailable.
try:  # pragma: no cover - depends on the deployment environment
    from ortools.constraint_solver import pywrapcp
except Exception:  # noqa: BLE001
    pywrapcp = None  # type: ignore[assignment]

from app.services.geocoding.base import Coordinates
from app.services.optimization.models import (
    ConstraintViolation,
    DeliveryNode,
    InfeasibilityReason,
    NodeKind,
    ObjectiveWeights,
    OptimizationNode,
    OptimizationProblem,
    OptimizationResult,
    OptimizationStatus,
    ScheduledStop,
    SolverDiagnostics,
    UnassignedDelivery,
    VehicleNode,
    VehicleRoute,
    ViolationKind,
)
from app.services.routing.base import MatrixResult

logger = logging.getLogger("routeiq.services.optimization.optimizer")


class SolverUnavailableError(RuntimeError):
    """Raised when the OR-Tools routing solver is not usable in this deployment."""

    http_status = 503
    user_message = (
        "Route optimisation is unavailable on this server: the OR-Tools solver "
        "could not be loaded. The rest of RouteIQ is unaffected."
    )

#: Weights and distances are converted to integer grams / metres so OR-Tools
#: integer arithmetic never loses precision on fractional kilogram loads.
_WEIGHT_SCALE = 1000
_VOLUME_SCALE = 1000

#: Dropping a delivery is only ever considered when the caller opts in. The
#: penalty is large enough that the solver treats dropping as a last resort.
_DROP_PENALTY = 10_000_000_000


@dataclass
class NodeLayout:
    """Flat node numbering shared by the matrix, the model and the result."""

    deliveries: dict[int, int]
    vehicle_start: list[int]
    vehicle_end: list[int]
    coordinates: list[Coordinates]
    demand_kg: list[float]
    demand_m3: list[float]
    service_seconds: list[float]

    @property
    def size(self) -> int:
        return len(self.coordinates)

    @property
    def starts(self) -> list[int]:
        return list(self.vehicle_start)

    @property
    def ends(self) -> list[int]:
        return list(self.vehicle_end)

    def is_delivery_node(self, node: int) -> bool:
        return node < len(self.deliveries)


def build_layout(problem: OptimizationProblem) -> NodeLayout:
    """
    Assign a flat matrix index to every delivery and every vehicle endpoint.

    Layout: deliveries occupy ``0 .. n-1`` in database order, then each vehicle
    contributes a start node and an end node at ``n + 2v`` and ``n + 2v + 1``.
    """
    coordinates: list[Coordinates] = []
    demand_kg: list[float] = []
    demand_m3: list[float] = []
    service_seconds: list[float] = []

    deliveries: dict[int, int] = {}
    for delivery in sorted(problem.deliveries, key=lambda d: d.delivery_id):
        deliveries[delivery.delivery_id] = len(coordinates)
        coordinates.append(delivery.coordinates)
        demand_kg.append(delivery.weight_kg)
        demand_m3.append(delivery.volume_m3)
        service_seconds.append(delivery.service_seconds)

    vehicle_start: list[int] = []
    vehicle_end: list[int] = []
    for vehicle in sorted(problem.vehicles, key=lambda v: v.vehicle_id):
        vehicle_start.append(len(coordinates))
        coordinates.append(vehicle.start)
        demand_kg.append(0.0)
        demand_m3.append(0.0)
        service_seconds.append(0.0)

        vehicle_end.append(len(coordinates))
        coordinates.append(vehicle.end)
        demand_kg.append(0.0)
        demand_m3.append(0.0)
        service_seconds.append(0.0)

    return NodeLayout(
        deliveries=deliveries,
        vehicle_start=vehicle_start,
        vehicle_end=vehicle_end,
        coordinates=coordinates,
        demand_kg=demand_kg,
        demand_m3=demand_m3,
        service_seconds=service_seconds,
    )


def compute_horizon(problem: OptimizationProblem, matrix: MatrixResult) -> int:
    """
    An upper bound on any route's total elapsed time, in seconds.

    Over-estimating is harmless (it only widens the solver's search space);
    under-estimating would manufacture false infeasibility, so this errs high.
    """
    if not matrix.durations_seconds:
        return 3600

    longest_leg = max((max(row) for row in matrix.durations_seconds), default=0.0)
    total_service = sum(
        d.service_seconds for d in problem.deliveries
    )
    latest_window = 0.0
    reference = problem.reference_time
    for delivery in problem.deliveries:
        if delivery.time_window.end is not None:
            latest_window = max(
                latest_window, (delivery.time_window.end - reference).total_seconds()
            )
    for vehicle in problem.vehicles:
        if vehicle.available_until is not None:
            latest_window = max(
                latest_window, (vehicle.available_until - reference).total_seconds()
            )
        if vehicle.available_from is not None:
            latest_window = max(
                latest_window, (vehicle.available_from - reference).total_seconds()
            )

    # Worst case: a vehicle drives the longest leg for every stop it visits.
    legs = len(problem.deliveries) + 1
    return int(latest_window + longest_leg * legs + total_service + 3600)


def build_cost_callback(
    layout: NodeLayout,
    matrix: MatrixResult,
    objective: ObjectiveWeights,
    manager: "pywrapcp.RoutingIndexManager",
    priority_of_node: dict[int, str],
):
    """
    Build the OR-Tools arc-cost function.

    Every enabled objective term is expressed in "equivalent metres" so the
    solver always minimises a single integer cost. Adding a new cost term means
    adding one `if` here and one field on `ObjectiveWeights` — nothing else in
    the engine changes.
    """

    def callback(from_index: int, to_index: int) -> int:
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)

        cost = 0.0
        if objective.distance_m:
            cost += objective.distance_m * matrix.distances_meters[i][j]
        if objective.duration_s:
            cost += objective.duration_s * matrix.durations_seconds[i][j]
        if objective.priority_credit_m:
            priority = priority_of_node.get(j)
            if priority:
                cost -= objective.priority_credit_m * objective.priority_credits.get(priority, 0.0)

        return int(round(cost))

    return callback


def _relative_seconds(moment: Optional[datetime], reference: datetime) -> Optional[int]:
    if moment is None:
        return None
    return int((moment - reference).total_seconds())


def solve(
    problem: OptimizationProblem,
    *,
    matrix: Optional[MatrixResult] = None,
) -> OptimizationResult:
    """
    Synchronous solve. Prefer :func:`solve_async`, which keeps the event loop free.

    Returns an `OptimizationResult`; never raises for an unsolvable-but-valid
    problem — that is reported as `OptimizationStatus.INFEASIBLE` with a reason.
    """
    if pywrapcp is None:
        raise SolverUnavailableError(SolverUnavailableError.user_message)

    matrix = matrix or problem.matrix
    if matrix is None:
        raise ValueError("A travel matrix is required before solving.")
    if not problem.deliveries:
        return OptimizationResult(
            status=OptimizationStatus.INFEASIBLE,
            reason=InfeasibilityReason.NO_DELIVERIES,
            message="There are no routable deliveries to optimize.",
        )
    if not problem.vehicles:
        return OptimizationResult(
            status=OptimizationStatus.INFEASIBLE,
            reason=InfeasibilityReason.NO_VEHICLES,
            message="Optimization could not find a feasible solution because no vehicles are available.",
        )

    layout = build_layout(problem)
    if layout.size < 2:
        raise ValueError("The travel matrix needs at least two locations.")

    priority_of_node = {
        layout.deliveries[d.delivery_id]: d.priority for d in problem.deliveries
    }

    manager = pywrapcp.RoutingIndexManager(
        layout.size, len(problem.vehicles), layout.starts, layout.ends
    )
    routing = pywrapcp.RoutingModel(manager)

    # ── Objective ─────────────────────────────────────────────────────────────
    routing.SetArcCostEvaluatorOfAllVehicles(
        routing.RegisterTransitCallback(build_cost_callback(layout, matrix, problem.objective, manager, priority_of_node))
    )

    enforced = problem.enforced_dimensions
    horizon = compute_horizon(problem, matrix)

    # ── Capacity ──────────────────────────────────────────────────────────────
    if "weight_kg" in enforced:

        def weight_callback(from_index: int) -> int:
            return int(round(layout.demand_kg[manager.IndexToNode(from_index)] * _WEIGHT_SCALE))

        routing.AddDimensionWithVehicleCapacity(
            routing.RegisterUnaryTransitCallback(weight_callback),
            0,
            [int(round(v.capacity.weight_kg * _WEIGHT_SCALE)) for v in problem.vehicles],
            True,
            "CapacityKg",
        )

    if "volume_m3" in enforced:

        def volume_callback(from_index: int) -> int:
            return int(round(layout.demand_m3[manager.IndexToNode(from_index)] * _VOLUME_SCALE))

        routing.AddDimensionWithVehicleCapacity(
            routing.RegisterUnaryTransitCallback(volume_callback),
            0,
            [int(round(v.capacity.volume_m3 * _VOLUME_SCALE)) for v in problem.vehicles],
            True,
            "CapacityM3",
        )

    # ── Time, time windows and vehicle availability ──────────────────────────
    time_dim = None
    if "time_windows" in enforced or "vehicle_availability" in enforced:

        def time_callback(from_index: int, to_index: int) -> int:
            i = manager.IndexToNode(from_index)
            j = manager.IndexToNode(to_index)
            # Service time is charged on the arc leaving the node being served.
            return int(round(
                matrix.durations_seconds[i][j] + layout.service_seconds[i]
            ))

        # Slack > 0 is what allows a vehicle to *wait* before a delivery instead
        # of arriving early and being considered late. The dimension capacity has
        # to cover the worst case of travel plus the waiting we permit, otherwise
        # the cumulative variable runs out of room and the plan is rejected.
        step_budget = (
            int(matrix.max_duration_seconds * (layout.size + 1))
            + int(sum(layout.service_seconds))
        )
        routing.AddDimension(
            routing.RegisterTransitCallback(time_callback),
            horizon,  # generous slack => the vehicle may wait before a delivery
            horizon + step_budget,
            True,
            "Time",
        )
        # AddDimension returns a bool; fetch the dimension itself for windows.
        time_dim = routing.GetDimensionOrDie("Time")

        reference = problem.reference_time
        for delivery in problem.deliveries:
            index = manager.NodeToIndex(layout.deliveries[delivery.delivery_id])
            earliest = _relative_seconds(delivery.time_window.start, reference)
            latest = _relative_seconds(delivery.time_window.end, reference)
            # No start => open from the beginning of the shift; no end => open
            # until the horizon. A window that has already closed was rejected
            # earlier by check_time_window_feasibility().
            time_dim.CumulVar(index).SetRange(
                max(0, earliest) if earliest is not None else 0,
                min(horizon, latest) if latest is not None else horizon,
            )

        for vehicle_index, vehicle in enumerate(problem.vehicles):
            departure = _relative_seconds(vehicle.available_from, reference)
            deadline = _relative_seconds(vehicle.available_until, reference)
            start_index = routing.Start(vehicle_index)
            end_index = routing.End(vehicle_index)

            earliest_departure = max(0, departure) if departure is not None else 0
            # The vehicle may wait at the depot, so the end is open-ended unless
            # the caller supplied a hard return deadline.
            latest_return = min(horizon, deadline) if deadline is not None else horizon
            time_dim.CumulVar(start_index).SetRange(earliest_departure, horizon)
            time_dim.CumulVar(end_index).SetRange(earliest_departure, latest_return)

    # ── Optional: allow the solver to drop deliveries it cannot place ─────────
    if problem.allow_partial:
        for node in layout.deliveries.values():
            routing.AddDisjunction([manager.NodeToIndex(node)], _DROP_PENALTY)

    # ── Search strategy ──────────────────────────────────────────────────────
    # Only the time limit is set. Pinning `first_solution_strategy` or
    # `local_search_metaheuristic` switches off OR-Tools' early optimality
    # termination, so a four-node problem would burn the entire budget instead of
    # returning in a millisecond. Its defaults already pick a sensible strategy
    # and stop as soon as the solution cannot be improved.
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.time_limit.FromSeconds(max(1, int(round(problem.time_limit_seconds))))
    params.log_search = False

    started = time.perf_counter()
    assignment = routing.SolveWithParameters(params)
    wall_time_ms = int((time.perf_counter() - started) * 1000)

    if assignment is None:
        return OptimizationResult(
            status=OptimizationStatus.INFEASIBLE,
            reason=InfeasibilityReason.CONSTRAINTS_CONFLICT,
            message=(
                "Optimization could not find a feasible solution because no combination "
                "of vehicles and stop order satisfies every constraint together. "
                "Try relaxing a time window, adding a vehicle, or enabling "
                "allow_partial to serve as many deliveries as possible."
            ),
            diagnostics=SolverDiagnostics(
                wall_time_ms=wall_time_ms,
                vehicles_available=len(problem.vehicles),
                matrix_nodes=layout.size,
                matrix_degraded=matrix.degraded,
                matrix_source=f"{matrix.provider}:{matrix.profile}",
                time_limit_seconds=problem.time_limit_seconds,
            ),
            violations=diagnose_infeasibility(problem),
        )

    diagnostics = SolverDiagnostics(
        # OR-Tools 9.x exposes the objective on the Assignment, not the solver.
        objective_value=float(assignment.ObjectiveValue() or 0),
        wall_time_ms=wall_time_ms,
        vehicles_available=len(problem.vehicles),
        matrix_nodes=layout.size,
        matrix_degraded=matrix.degraded,
        matrix_source=f"{matrix.provider}:{matrix.profile}",
        time_limit_seconds=problem.time_limit_seconds,
    )

    routes = _extract_routes(problem, matrix, layout, manager, routing, assignment, time_dim)

    # A run that stopped on the time limit is feasible but not provably optimal.
    if diagnostics.wall_time_ms >= problem.time_limit_seconds * 1000 - 250:
        status = OptimizationStatus.FEASIBLE
    else:
        status = OptimizationStatus.OPTIMAL

    assigned_ids = {stop.delivery_id for route in routes for stop in route.stops}
    unassigned = [
        UnassignedDelivery(
            delivery_id=delivery.delivery_id,
            tracking_number=delivery.tracking_number,
            customer_name=delivery.customer_name,
            address=delivery.address,
            priority=delivery.priority,
            weight_kg=delivery.weight_kg,
            reason="No vehicle could reach this delivery within its constraints.",
        )
        for delivery in problem.deliveries
        if delivery.delivery_id not in assigned_ids
    ]

    if unassigned:
        status = OptimizationStatus.PARTIAL

    violations = _collect_violations(problem, routes)

    return OptimizationResult(
        status=status,
        routes=routes,
        unassigned=unassigned,
        violations=violations,
        diagnostics=diagnostics,
        message=(
            f"{len(routes)} route(s) assigned, {len(unassigned)} delivery/deliveries left unassigned."
            if unassigned
            else None
        ),
    )


async def solve_async(
    problem: OptimizationProblem,
    *,
    matrix: Optional[MatrixResult] = None,
) -> OptimizationResult:
    """
    Run :func:`solve` off the event loop.

    The solve is CPU-bound, so it is dispatched to a worker thread. That keeps
    small optimizations responsive and is the seam a future background job
    worker would move this call behind.
    """
    return await asyncio.to_thread(solve, problem, matrix=matrix)


# ── Result extraction ─────────────────────────────────────────────────────────


def _extract_routes(
    problem: OptimizationProblem,
    matrix: MatrixResult,
    layout: NodeLayout,
    manager: "pywrapcp.RoutingIndexManager",
    routing: "pywrapcp.RoutingModel",
    assignment: "pywrapcp.Assignment",
    time_dim: Optional["pywrapcp.RoutingDimension"],
) -> list[VehicleRoute]:
    vehicles = sorted(problem.vehicles, key=lambda v: v.vehicle_id)
    # layout.deliveries maps delivery_id -> node index; invert it for lookups.
    node_to_delivery = {
        layout.deliveries[d.delivery_id]: d for d in problem.deliveries
    }
    routes: list[VehicleRoute] = []

    for vehicle_index, vehicle in enumerate(vehicles):
        index = routing.Start(vehicle_index)
        stop_nodes: list[int] = []
        guard = 0
        while not routing.IsEnd(index):
            guard += 1
            if guard > layout.size + 5:  # pragma: no cover — solver never emits cycles
                logger.error("Detected a cycle while extracting vehicle route %s", vehicle.vehicle_number)
                break
            node = manager.IndexToNode(index)
            if layout.is_delivery_node(node):
                stop_nodes.append(node)
            index = assignment.Value(routing.NextVar(index))

        if not stop_nodes:
            continue

        route = _build_route(
            vehicle=vehicle,
            stop_nodes=stop_nodes,
            problem=problem,
            matrix=matrix,
            layout=layout,
            node_to_delivery=node_to_delivery,
            start_node=layout.vehicle_start[vehicle_index],
            end_node=layout.vehicle_end[vehicle_index],
            time_dim=time_dim,
            manager=manager,
            routing=routing,
            assignment=assignment,
        )
        routes.append(route)

    return routes


def _build_route(
    *,
    vehicle: VehicleNode,
    stop_nodes: list[int],
    problem: OptimizationProblem,
    matrix: MatrixResult,
    layout: NodeLayout,
    node_to_delivery: dict[int, DeliveryNode],
    start_node: int,
    end_node: int,
    time_dim,
    manager,
    routing,
    assignment,
) -> VehicleRoute:
    """
    Turn a node sequence into a fully scheduled `VehicleRoute`.

    The schedule is recomputed here from the same real matrix the solver used,
    so every reported arrival time, waiting time and total is derived from actual
    road durations rather than from the solver's internal state.
    """
    reference = problem.reference_time
    departure = _relative_seconds(vehicle.available_from, reference) or 0

    clock = float(max(0, departure))
    previous = start_node
    distance = 0.0
    driving = 0.0
    waiting = 0.0
    used_kg = 0.0
    used_m3 = 0.0

    stops: list[ScheduledStop] = []
    for sequence, node in enumerate(stop_nodes, start=1):
        delivery = node_to_delivery[node]
        leg_distance = matrix.distances_meters[previous][node]
        leg_duration = matrix.durations_seconds[previous][node]
        distance += leg_distance
        driving += leg_duration

        arrival = clock + leg_duration
        window_start = _relative_seconds(delivery.time_window.start, reference)
        window_end = _relative_seconds(delivery.time_window.end, reference)

        service_start = arrival
        if window_start is not None:
            service_start = max(service_start, float(max(0, window_start)))
        wait = service_start - arrival
        waiting += wait

        service_end = service_start + delivery.service_seconds
        late_by = 0.0
        if window_end is not None:
            late_by = max(0.0, service_start - window_end)

        stops.append(
            ScheduledStop(
                sequence=sequence,
                delivery_id=delivery.delivery_id,
                tracking_number=delivery.tracking_number,
                customer_name=delivery.customer_name,
                address=delivery.address,
                coordinates=delivery.coordinates,
                priority=delivery.priority,
                arrival=reference + timedelta(seconds=arrival),
                service_start=reference + timedelta(seconds=service_start),
                service_end=reference + timedelta(seconds=service_end),
                wait_seconds=round(wait, 1),
                driving_seconds=round(leg_duration, 1),
                window_start=delivery.time_window.start,
                window_end=delivery.time_window.end,
                late_by_seconds=round(late_by, 1),
            )
        )

        used_kg += delivery.weight_kg
        used_m3 += delivery.volume_m3
        clock = service_end
        previous = node

    # Return leg back to the vehicle's end node.
    return_distance = matrix.distances_meters[previous][end_node]
    return_duration = matrix.durations_seconds[previous][end_node]
    distance += return_distance
    driving += return_duration
    clock += return_duration

    deadline = _relative_seconds(vehicle.available_until, reference)
    return_time = reference + timedelta(seconds=clock)

    return VehicleRoute(
        vehicle=vehicle,
        stops=stops,
        start=_node_for(layout, start_node, NodeKind.VEHICLE_START, vehicle.vehicle_number, vehicle.vehicle_id),
        end=_node_for(layout, end_node, NodeKind.VEHICLE_END, vehicle.vehicle_number, vehicle.vehicle_id),
        distance_meters=round(distance, 1),
        duration_seconds=round(clock - max(0, departure), 1),
        capacity_used_kg=round(used_kg, 3),
        capacity_used_m3=round(used_m3, 3),
        return_time=return_time,
        total_wait_seconds=round(waiting, 1),
        geometry=[],
        bounds=None,
    )


def _node_for(
    layout: NodeLayout, node: int, kind: NodeKind, label: str, reference_id: int
) -> OptimizationNode:
    return OptimizationNode(
        key=f"{kind.value}:{reference_id}",
        kind=kind,
        coordinates=layout.coordinates[node],
        label=label,
        reference_id=reference_id,
        vehicle_id=reference_id,
    )


# ── Diagnostics ───────────────────────────────────────────────────────────────


def diagnose_infeasibility(problem: OptimizationProblem) -> list[ConstraintViolation]:
    """
    Best-effort explanation of *why* a solve failed.

    Run after the solver reports no solution. Cheap O(n) checks are tried first,
    so the common capacity/window causes produce a specific message instead of
    the generic "constraints could not be satisfied".
    """
    violations: list[ConstraintViolation] = []

    # 1. One delivery heavier than any vehicle.
    if problem.vehicles and problem.deliveries:
        best_kg = max((v.capacity.weight_kg for v in problem.vehicles), default=0.0)
        for delivery in problem.deliveries:
            if best_kg > 0 and delivery.weight_kg > best_kg + 1e-6:
                violations.append(
                    ConstraintViolation(
                        kind=ViolationKind.CAPACITY,
                        subject=delivery.tracking_number,
                        delivery_id=delivery.delivery_id,
                        message=(
                            f"{delivery.weight_kg:g} kg exceeds the largest vehicle capacity "
                            f"({best_kg:g} kg)."
                        ),
                    )
                )
        if violations:
            return violations

    # 2. Fleet-wide capacity short.
    if problem.total_capacity_kg > 0 and problem.total_demand_kg > problem.total_capacity_kg + 1e-6:
        violations.append(
            ConstraintViolation(
                kind=ViolationKind.CAPACITY,
                subject="fleet",
                message=(
                    f"Total demand {problem.total_demand_kg:g} kg exceeds total fleet capacity "
                    f"{problem.total_capacity_kg:g} kg."
                ),
            )
        )
        return violations

    if problem.total_capacity_m3 > 0 and problem.total_demand_m3 > problem.total_capacity_m3 + 1e-6:
        violations.append(
            ConstraintViolation(
                kind=ViolationKind.CAPACITY,
                subject="fleet",
                message=(
                    f"Total volume {problem.total_demand_m3:g} m³ exceeds total fleet capacity "
                    f"{problem.total_capacity_m3:g} m³."
                ),
            )
        )
        return violations

    # 3. Too few vehicles for the workload even when capacity adds up.
    if problem.deliveries and len(problem.vehicles) < 1:
        violations.append(
            ConstraintViolation(
                kind=ViolationKind.CAPACITY,
                subject="fleet",
                message="No vehicles are available to carry any delivery.",
            )
        )
        return violations

    # 4. Time windows that overlap each vehicle's availability.
    reference = problem.reference_time
    for delivery in problem.deliveries:
        window = delivery.time_window
        if window.end is not None and window.end < reference:
            violations.append(
                ConstraintViolation(
                    kind=ViolationKind.TIME_WINDOW_END,
                    subject=delivery.tracking_number,
                    delivery_id=delivery.delivery_id,
                    message=(
                        f"Window closed at {window.end.isoformat()}, before the optimization "
                        f"reference time."
                    ),
                )
            )

    if violations:
        return violations

    # 5. Give up precisely rather than guessing.
    return [
        ConstraintViolation(
            kind=ViolationKind.CAPACITY,
            subject="solver",
            message=(
                "The combination of capacity, time windows and vehicle availability left no "
                "feasible assignment. Try relaxing a time window, adding a vehicle, or allowing "
                "a partial plan."
            ),
        )
    ]


def _collect_violations(
    problem: OptimizationProblem, routes: list[VehicleRoute]
) -> list[ConstraintViolation]:
    """
    Post-solve audit of a returned plan.

    The engine asserts its own output: no vehicle may exceed capacity and no stop
    may be delivered outside its window. A non-empty result here means the plan
    shown to the operator is not actually valid, which the API surfaces rather
    than hides.
    """
    violations: list[ConstraintViolation] = []

    for route in routes:
        capacity = route.vehicle.capacity
        if capacity.weight_kg > 0 and route.capacity_used_kg > capacity.weight_kg + 1e-6:
            violations.append(
                ConstraintViolation(
                    kind=ViolationKind.CAPACITY,
                    subject=route.vehicle.vehicle_number,
                    vehicle_id=route.vehicle.vehicle_id,
                    message=(
                        f"Load {route.capacity_used_kg:g} kg exceeds capacity "
                        f"{capacity.weight_kg:g} kg."
                    ),
                )
            )
        if capacity.volume_m3 > 0 and route.capacity_used_m3 > capacity.volume_m3 + 1e-6:
            violations.append(
                ConstraintViolation(
                    kind=ViolationKind.CAPACITY,
                    subject=route.vehicle.vehicle_number,
                    vehicle_id=route.vehicle.vehicle_id,
                    message=(
                        f"Volume {route.capacity_used_m3:g} m³ exceeds capacity "
                        f"{capacity.volume_m3:g} m³."
                    ),
                )
            )

        if route.vehicle.available_until is not None and route.return_time is not None:
            if route.return_time > route.vehicle.available_until:
                violations.append(
                    ConstraintViolation(
                        kind=ViolationKind.TIME_WINDOW_END,
                        subject=route.vehicle.vehicle_number,
                        vehicle_id=route.vehicle.vehicle_id,
                        message=(
                            f"Vehicle returns {route.return_time.isoformat()}, after its "
                            f"availability deadline {route.vehicle.available_until.isoformat()}."
                        ),
                    )
                )

        for stop in route.stops:
            if stop.is_late:
                violations.append(
                    ConstraintViolation(
                        kind=ViolationKind.TIME_WINDOW_END,
                        subject=stop.tracking_number,
                        delivery_id=stop.delivery_id,
                        vehicle_id=route.vehicle.vehicle_id,
                        message=(
                            f"Arrives {stop.late_by_seconds / 60.0:.1f} min after the window "
                            f"closes at "
                            f"{stop.window_end.isoformat() if stop.window_end else 'n/a'}."
                        ),
                    )
                )

    return violations


def build_baseline(problem: OptimizationProblem, matrix: MatrixResult):
    """
    Build the clearly-labelled "before" comparison.

    The baseline visits deliveries in their existing database order, greedily
    packed into the same vehicles with no reordering, measured on the same real
    matrix. It is explicitly *not* a claim about previously executed routes —
    the API labels it as "original delivery order".
    """
    from app.services.optimization.models import BaselinePlan

    layout = build_layout(problem)

    remaining = sorted(problem.deliveries, key=lambda d: d.delivery_id)
    total_distance = 0.0
    total_duration = 0.0
    vehicles_used = 0

    for vehicle_index, vehicle in enumerate(sorted(problem.vehicles, key=lambda v: v.vehicle_id)):
        start_node = layout.vehicle_start[vehicle_index]
        end_node = layout.vehicle_end[vehicle_index]

        assigned: list[DeliveryNode] = []
        used_kg = 0.0
        used_m3 = 0.0
        for delivery in remaining:
            if vehicle.capacity.allows(delivery.weight_kg, delivery.volume_m3):
                if vehicle.capacity.weight_kg > 0 and used_kg + delivery.weight_kg > vehicle.capacity.weight_kg + 1e-6:
                    continue
                if vehicle.capacity.volume_m3 > 0 and used_m3 + delivery.volume_m3 > vehicle.capacity.volume_m3 + 1e-6:
                    continue
                assigned.append(delivery)
                used_kg += delivery.weight_kg
                used_m3 += delivery.volume_m3

        if not assigned:
            continue

        vehicles_used += 1
        remaining = [d for d in remaining if d not in assigned]

        previous = start_node
        clock = 0.0
        for delivery in assigned:
            node = layout.deliveries[delivery.delivery_id]
            total_distance += matrix.distances_meters[previous][node]
            clock += matrix.durations_seconds[previous][node]
            clock += delivery.service_seconds
            previous = node
        total_distance += matrix.distances_meters[previous][end_node]
        clock += matrix.durations_seconds[previous][end_node]
        total_duration += clock

    return BaselinePlan(
        label="Original delivery order",
        description=(
            "Deliveries assigned in their existing database order with no reordering, measured "
            "on the same live travel matrix. This is a reference point, not a record of routes "
            "previously driven."
        ),
        total_distance_meters=round(total_distance, 1),
        total_duration_seconds=round(total_duration, 1),
        vehicles_used=vehicles_used,
    )


__all__ = [
    "NodeLayout",
    "build_baseline",
    "build_cost_callback",
    "build_layout",
    "compute_horizon",
    "diagnose_infeasibility",
    "solve",
    "solve_async",
]
