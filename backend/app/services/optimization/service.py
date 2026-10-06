"""
Optimisation orchestration service.

The endpoint handler stays thin: it hands the request here and returns (or
translates) the outcome. Everything that a reader would want to follow —
reading the database, deciding eligibility, building the travel matrix, solving,
auditing the plan, comparing against the baseline — happens in this one place.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.delivery import Delivery
from app.models.vehicle import Vehicle
from app.schemas.optimization import (
    BaselineComparisonResponse,
    BaselineResponse,
    CapacityUsageResponse,
    ConstraintViolationResponse,
    OptimizationPreferencesRequest,
    OptimizationRequest,
    OptimizationResponse,
    OptimizationSummaryResponse,
    OptimizedStopResponse,
    RouteEndpointResponse,
    SolverDiagnosticsResponse,
    UnassignedDeliveryResponse,
    VehicleRouteResponse,
)
from app.services.geocoding.base import Coordinates
from app.services.geocoding.resolver import resolve_address
from app.services.optimization.constraints import (
    EligibilityReport,
    OptimizationInputError,
    build_default_objective,
    build_delivery_node,
    build_vehicle_node,
    check_capacity_feasibility,
    check_time_window_feasibility,
    check_vehicle_availability_feasibility,
    report_eligibility,
    summarise_problem,
    validate_coordinates,
)
from app.services.optimization.matrix import MatrixBuildError, build_travel_matrix
from app.services.optimization.models import (
    Comparison,
    InfeasibilityReason,
    OptimizationProblem,
    OptimizationResult,
    OptimizationStatus,
    TimeWindow,
    UnassignedDelivery,
    VehicleNode,
    VehicleRoute,
    ViolationKind,
    to_naive_utc,
)
from app.services.optimization.optimizer import build_baseline, solve_async
from app.services.providers.errors import (
    InvalidCoordinatesError,
    InvalidLocationError,
    ProviderError,
    ProviderNotFoundError,
)
from app.services.routing.base import RouteStop
from app.services.routing.registry import get_routing_service

logger = logging.getLogger("routeiq.services.optimization")

#: Hard ceiling on nodes in one matrix, protecting the provider and the solver.
MAX_MATRIX_NODES = 220


class OptimizationService:
    """Reads real data, solves the VRP, and returns a reportable plan."""

    async def optimize(
        self, db: Session, request: OptimizationRequest
    ) -> OptimizationResponse:
        preferences = request.preferences or OptimizationPreferencesRequest()
        optimization_id = request.optimization_id or f"opt_{uuid4().hex[:12]}"
        reference_time = self._reference_time(preferences)

        warnings: list[str] = []

        # ── 1. Read real data and decide what takes part ──────────────────────
        eligibility, vehicle_rows, delivery_rows = self._load_participants(db, request)
        warnings.extend(eligibility.notes)

        # Only routable rows reach the solver — delivered/cancelled deliveries
        # and unavailable vehicles are excluded here, not merely reported.
        routable_delivery_ids = set(eligibility.routable_delivery_ids)
        routable_vehicle_ids = set(eligibility.routable_vehicle_ids)
        delivery_rows = [d for d in delivery_rows if d.id in routable_delivery_ids]
        vehicle_rows = [v for v in vehicle_rows if v.id in routable_vehicle_ids]

        delivery_nodes, missing_coordinates = await self._build_delivery_nodes(
            delivery_rows, preferences
        )
        if missing_coordinates:
            listed = ", ".join(sorted(missing_coordinates)[:10])
            raise OptimizationInputError(
                f"Optimization could not run because {len(missing_coordinates)} "
                f"delivery/deliveries have no coordinates: {listed}. Geocode them first.",
                reason=InfeasibilityReason.MISSING_COORDINATES,
            )

        vehicle_nodes, vehicles_without_position = self._build_vehicle_nodes(
            vehicle_rows, preferences
        )
        if vehicles_without_position:
            listed = ", ".join(sorted(vehicles_without_position)[:10])
            warnings.append(
                f"{len(vehicles_without_position)} available vehicle(s) were left out because "
                f"they have no recorded start position: {listed}."
            )

        if not vehicle_nodes:
            raise OptimizationInputError(
                self._no_vehicles_message(eligibility, vehicles_without_position),
                reason=InfeasibilityReason.NO_VEHICLES,
            )
        if not delivery_nodes:
            raise OptimizationInputError(
                self._no_deliveries_message(eligibility, missing_coordinates),
                reason=InfeasibilityReason.NO_DELIVERIES,
            )

        # ── 2. Assemble and validate the problem ──────────────────────────────
        routing_service = get_routing_service()
        problem = OptimizationProblem(
            deliveries=delivery_nodes,
            vehicles=vehicle_nodes,
            profile=request.profile,
            objective=self._objective(preferences),
            reference_time=reference_time,
            time_limit_seconds=preferences.time_limit_seconds,
            allow_partial=preferences.allow_partial,
            routing_provider=routing_service.provider_id,
        )

        if len(delivery_nodes) + 2 * len(vehicle_nodes) > MAX_MATRIX_NODES:
            raise OptimizationInputError(
                f"Optimization is limited to {MAX_MATRIX_NODES} locations in one request "
                f"(this request implies {len(delivery_nodes) + 2 * len(vehicle_nodes)}). "
                "Narrow the selection or run smaller batches.",
                reason=InfeasibilityReason.CONSTRAINTS_CONFLICT,
            )

        check_capacity_feasibility(problem)
        check_vehicle_availability_feasibility(problem)
        check_time_window_feasibility(problem)
        validate_coordinates(delivery_nodes, vehicle_nodes)

        # Locations to geocode: the matrix needs every delivery and both of each
        # vehicle's endpoints. A vehicle whose endpoints differ is rare, but the
        # matrix builder is generic over coordinates so nothing breaks.
        problem_log = summarise_problem(problem)
        logger.info("[optimize %s] solving: %s", optimization_id, problem_log)

        # ── 3. Build the real travel matrix ───────────────────────────────────
        coordinates = self._matrix_coordinates(problem)
        try:
            matrix = await build_travel_matrix(
                coordinates,
                profile=problem.profile,
                provider_id=routing_service.provider_id,
                allow_pairwise_fallback=preferences.allow_pairwise_fallback,
            )
        except MatrixBuildError as exc:
            raise OptimizationInputError(
                str(exc),
                reason=InfeasibilityReason.NO_ROUTE_AVAILABLE,
            ) from exc
        except ProviderNotFoundError:
            raise
        problem.matrix = matrix
        if matrix.degraded:
            warnings.append(
                "The configured routing provider has no travel-matrix endpoint, so this result "
                "was assembled from individual routes. Distances are still real road distances."
            )

        # ── 4. Solve ─────────────────────────────────────────────────────────
        result = await solve_async(problem, matrix=matrix)

        if result.status is OptimizationStatus.INFEASIBLE:
            # Report the solver's own diagnosis, or the pre-flight reason.
            return self._infeasible_response(
                optimization_id=optimization_id,
                problem=problem,
                result=result,
                warnings=warnings,
            )

        # ── 5. Audit, compare, and shape the response ─────────────────────────
        baseline = build_baseline(problem, matrix)
        comparison = Comparison(
            baseline=baseline,
            optimized_distance_meters=result.total_distance_meters,
            optimized_duration_seconds=result.total_duration_seconds,
            distance_saved_meters=round(baseline.total_distance_meters - result.total_distance_meters, 1),
            duration_saved_seconds=round(baseline.total_duration_seconds - result.total_duration_seconds, 1),
            distance_saved_percent=_percent_saved(
                baseline.total_distance_meters, result.total_distance_meters
            ),
        )

        violations = result.violations
        if violations:
            warnings.append(
                f"The solver returned a plan that breaks {len(violations)} constraint(s). "
                "They are listed with the result."
            )

        # The matrix decides the order; the road lines are drawn afterwards.
        await self._enrich_routes_with_geometry(
            result.routes, routing_service, problem.profile, warnings
        )

        return OptimizationResponse(
            optimization_id=optimization_id,
            status=result.status,
            message=result.message,
            provider=matrix.provider,
            profile=matrix.profile or problem.profile,
            summary=self._summary(problem, result),
            routes=[self._vehicle_route(route, problem) for route in result.routes],
            unassigned=[self._unassigned(item) for item in result.unassigned],
            violations=[self._violation(v) for v in violations],
            baseline=BaselineComparisonResponse(
                baseline=BaselineResponse(
                    label=baseline.label,
                    description=baseline.description,
                    total_distance_meters=baseline.total_distance_meters,
                    distance_km=baseline.distance_km,
                    total_duration_seconds=baseline.total_duration_seconds,
                    duration_minutes=baseline.duration_minutes,
                    vehicles_used=baseline.vehicles_used,
                ),
                optimized_distance_meters=comparison.optimized_distance_meters,
                optimized_distance_km=round(comparison.optimized_distance_meters / 1000.0, 3),
                optimized_duration_seconds=comparison.optimized_duration_seconds,
                optimized_duration_minutes=round(comparison.optimized_duration_seconds / 60.0, 1),
                distance_saved_meters=comparison.distance_saved_meters,
                distance_saved_km=comparison.distance_saved_km,
                duration_saved_seconds=comparison.duration_saved_seconds,
                duration_saved_minutes=comparison.duration_saved_minutes,
                distance_saved_percent=comparison.distance_saved_percent,
            ),
            solver=SolverDiagnosticsResponse(
                objective_value=result.diagnostics.objective_value,
                wall_time_ms=result.diagnostics.wall_time_ms,
                vehicles_available=result.diagnostics.vehicles_available,
                matrix_nodes=result.diagnostics.matrix_nodes,
                matrix_source=result.diagnostics.matrix_source,
                matrix_degraded=result.diagnostics.matrix_degraded,
                time_limit_seconds=result.diagnostics.time_limit_seconds,
                enforced_constraints=problem.enforced_dimensions,
                objective="minimize_total_travel_distance",
            ),
            warnings=warnings,
            computed_at=datetime.now(timezone.utc).isoformat(),
        )

    # ── Data loading ─────────────────────────────────────────────────────────

    def _load_participants(
        self, db: Session, request: OptimizationRequest
    ) -> tuple[EligibilityReport, list[Vehicle], list[Delivery]]:
        """
        Load vehicles and deliveries, then apply the eligibility policy.

        Explicitly requested IDs are honoured even if the default query would
        have filtered them out, so the caller gets exactly what it asked for.
        """
        vehicle_query = db.query(Vehicle)
        delivery_query = db.query(Delivery)

        if request.vehicle_ids:
            vehicle_query = vehicle_query.filter(Vehicle.id.in_(request.vehicle_ids))
        if request.delivery_ids:
            delivery_query = delivery_query.filter(Delivery.id.in_(request.delivery_ids))

        vehicle_rows = vehicle_query.order_by(Vehicle.id).all()
        delivery_rows = delivery_query.order_by(Delivery.id).all()

        # Validate that every requested ID actually exists before filtering.
        self._assert_ids_exist(db, request.delivery_ids, request.vehicle_ids)

        eligibility = report_eligibility(
            delivery_rows,
            vehicle_rows,
            requested_delivery_ids=request.delivery_ids,
            requested_vehicle_ids=request.vehicle_ids,
        )
        return eligibility, vehicle_rows, delivery_rows

    @staticmethod
    def _assert_ids_exist(
        db: Session,
        delivery_ids: Optional[Sequence[int]],
        vehicle_ids: Optional[Sequence[int]],
    ) -> None:
        if delivery_ids:
            # `db.query(Model.id)` yields one-column Rows, so unwrap row[0].
            found = {
                row[0]
                for row in db.query(Delivery.id).filter(Delivery.id.in_(delivery_ids)).all()
            }
            missing = [i for i in delivery_ids if i not in found]
            if missing:
                raise OptimizationInputError(
                    f"Unknown delivery id(s): {', '.join(str(i) for i in missing)}.",
                    reason=InfeasibilityReason.INVALID_DELIVERY_IDS,
                )
        if vehicle_ids:
            found = {
                row[0]
                for row in db.query(Vehicle.id).filter(Vehicle.id.in_(vehicle_ids)).all()
            }
            missing = [i for i in vehicle_ids if i not in found]
            if missing:
                raise OptimizationInputError(
                    f"Unknown vehicle id(s): {', '.join(str(i) for i in missing)}.",
                    reason=InfeasibilityReason.INVALID_DELIVERY_IDS,
                )

    async def _build_delivery_nodes(
        self, deliveries: list[Delivery], preferences: OptimizationPreferencesRequest
    ) -> tuple[list, set[str]]:
        """
        Convert deliveries into solver nodes, geocoding any that lack coordinates.

        A delivery with an address but no stored coordinates is geocoded here —
        the optimiser never invents a position, it resolves the real one.
        """
        nodes = []
        missing: set[str] = set()

        for delivery in deliveries:
            if delivery.latitude is not None and delivery.longitude is not None:
                node = build_delivery_node(
                    delivery, service_seconds=preferences.service_seconds_per_delivery
                )
                if node is not None:
                    nodes.append(node)
                continue

            address = (delivery.address or "").strip()
            if not address:
                missing.add(delivery.tracking_number)
                continue

            resolved = await resolve_address(address)
            if resolved is None:
                missing.add(delivery.tracking_number)
                continue

            delivery.latitude = resolved.coordinates.latitude
            delivery.longitude = resolved.coordinates.longitude
            node = build_delivery_node(
                delivery, service_seconds=preferences.service_seconds_per_delivery
            )
            if node is not None:
                nodes.append(node)

        return nodes, missing

    def _build_vehicle_nodes(
        self, vehicles: list[Vehicle], preferences: OptimizationPreferencesRequest
    ) -> tuple[list[VehicleNode], set[str]]:
        """
        Convert vehicles into solver nodes.

        A vehicle's start comes from its recorded position, or from the
        caller's configured depot when it has none. Vehicles with neither are
        reported, never given a made-up location.
        """
        nodes: list[VehicleNode] = []
        without_position: set[str] = set()

        for vehicle in vehicles:
            fallback = None
            if preferences.depot_latitude is not None and preferences.depot_longitude is not None:
                fallback = Coordinates(
                    latitude=preferences.depot_latitude, longitude=preferences.depot_longitude
                )

            node = build_vehicle_node(
                vehicle,
                use_current_position=preferences.use_current_vehicle_positions,
                fallback_start=fallback,
                available_from=self._parse_moment(preferences.shift_start),
                available_until=self._parse_moment(preferences.shift_end),
            )
            if node is None:
                without_position.add(vehicle.vehicle_number)
                continue
            nodes.append(node)

        return nodes, without_position

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _matrix_coordinates(self, problem: OptimizationProblem) -> list[Coordinates]:
        """
        Flat coordinate list in exactly the order `optimizer.build_layout` uses.

        Deliveries first (ascending id), then each vehicle's start and end.
        """
        coordinates = [
            d.coordinates for d in sorted(problem.deliveries, key=lambda d: d.delivery_id)
        ]
        for vehicle in sorted(problem.vehicles, key=lambda v: v.vehicle_id):
            coordinates.append(vehicle.start)
            coordinates.append(vehicle.end)
        return coordinates

    @staticmethod
    def _objective(preferences: OptimizationPreferencesRequest):
        if preferences.objective is None:
            return build_default_objective()
        return preferences.objective.to_domain()

    @staticmethod
    def _reference_time(preferences: OptimizationPreferencesRequest) -> datetime:
        """
        Everything is scheduled relative to this instant, normalised to naive UTC.

        Naive UTC is required because the delivery time-window columns are naive
        `DateTime`; comparing them with an aware instant would raise.
        """
        if preferences.reference_time is not None:
            return to_naive_utc(preferences.reference_time)
        if preferences.shift_start is not None:
            return to_naive_utc(preferences.shift_start)
        return to_naive_utc(datetime.now(timezone.utc))

    @staticmethod
    def _parse_moment(value: Optional[datetime]) -> Optional[datetime]:
        return to_naive_utc(value)

    @staticmethod
    def _no_vehicles_message(
        eligibility: EligibilityReport, without_position: set[str]
    ) -> str:
        if eligibility.skipped_vehicle_ids:
            return (
                "Optimization could not find a feasible solution because no available vehicles "
                "remain: every selected vehicle is offline, unavailable, or has no active driver."
            )
        if without_position:
            return (
                "Optimization could not find a feasible solution because no vehicle has a "
                "recorded start position. Update a vehicle's location or configure a depot."
            )
        return (
            "Optimization could not find a feasible solution because no available vehicles "
            "were found."
        )

    @staticmethod
    def _no_deliveries_message(
        eligibility: EligibilityReport, missing_coordinates: set[str]
    ) -> str:
        if eligibility.skipped_delivery_ids:
            return (
                "Optimization could not find a feasible solution because every selected delivery "
                "is already delivered or cancelled."
            )
        if missing_coordinates:
            return (
                "Optimization could not run because no selected delivery has resolvable "
                "coordinates."
            )
        return "There are no routable deliveries to optimize."

    def _summary(self, problem: OptimizationProblem, result: OptimizationResult):
        assigned = len(result.assigned_delivery_ids)
        return OptimizationSummaryResponse(
            total_distance_meters=result.total_distance_meters,
            total_distance_km=round(result.total_distance_meters / 1000.0, 3),
            total_duration_seconds=result.total_duration_seconds,
            total_duration_minutes=round(result.total_duration_seconds / 60.0, 1),
            vehicles_available=len(problem.vehicles),
            vehicles_used=len(result.routes),
            deliveries_eligible=len(problem.deliveries),
            deliveries_assigned=assigned,
            deliveries_unassigned=len(result.unassigned),
            total_demand_kg=problem.total_demand_kg,
            total_demand_m3=problem.total_demand_m3,
            total_capacity_kg=problem.total_capacity_kg,
            total_capacity_m3=problem.total_capacity_m3,
            constraints_enforced=problem.enforced_dimensions,
        )

    async def _enrich_routes_with_geometry(
        self,
        routes: Sequence[VehicleRoute],
        routing_service,
        profile: Optional[str],
        warnings: list[str],
    ) -> None:
        """
        Attach a real road polyline to every planned route.

        The matrix gives the right *order*, but the map needs actual road
        geometry, which only a route call can provide. Failures are reported as
        warnings instead of failing the whole plan: the assignments and ETAs stay
        valid without a polyline.
        """
        for route in routes:
            ordered = [route.start.coordinates]
            ordered.extend(stop.coordinates for stop in route.stops)
            ordered.append(route.end.coordinates)

            # Identical consecutive points make some providers reject the request.
            deduped: list[Coordinates] = []
            for point in ordered:
                if not deduped or deduped[-1] != point:
                    deduped.append(point)

            try:
                result = await routing_service.calculate_route(
                    [
                        RouteStop(
                            coordinates=point,
                            role="origin" if index == 0 else "destination",
                        )
                        for index, point in enumerate(deduped)
                    ],
                    profile=profile,
                )
            except (ProviderError, InvalidLocationError, InvalidCoordinatesError) as exc:
                warnings.append(
                    f"Could not draw the road line for vehicle {route.vehicle.vehicle_number}: "
                    f"{getattr(exc, 'user_message', None) or exc}"
                )
                continue

            # GeoJSON order is [lng, lat]; Leaflet expects [lat, lng].
            route.geometry = [
                [coordinate[1], coordinate[0]] for coordinate in result.geometry.coordinates
            ]

            if result.bounds is not None:
                route.bounds = [
                    result.bounds.min_latitude,
                    result.bounds.min_longitude,
                    result.bounds.max_latitude,
                    result.bounds.max_longitude,
                ]
            elif route.geometry:
                # Not every provider returns an explicit bbox (OSRM does not), so
                # derive it from the line the caller is about to draw.
                latitudes = [point[0] for point in route.geometry]
                longitudes = [point[1] for point in route.geometry]
                route.bounds = [
                    min(latitudes),
                    min(longitudes),
                    max(latitudes),
                    max(longitudes),
                ]

    def _vehicle_route(self, route: VehicleRoute, problem: OptimizationProblem):
        capacity = route.vehicle.capacity
        return VehicleRouteResponse(
            vehicle_id=route.vehicle.vehicle_id,
            vehicle_number=route.vehicle.vehicle_number,
            vehicle_name=route.vehicle.name,
            vehicle_status=route.vehicle.status,
            driver_id=route.vehicle.driver_id,
            driver_name=route.vehicle.driver_name,
            start=RouteEndpointResponse(
                label=route.start.label,
                latitude=route.start.coordinates.latitude,
                longitude=route.start.coordinates.longitude,
            ),
            end=RouteEndpointResponse(
                label=route.end.label,
                latitude=route.end.coordinates.latitude,
                longitude=route.end.coordinates.longitude,
            ),
            stops=[
                OptimizedStopResponse(
                    sequence=stop.sequence,
                    delivery_id=stop.delivery_id,
                    tracking_number=stop.tracking_number,
                    customer_name=stop.customer_name,
                    address=stop.address,
                    latitude=stop.coordinates.latitude,
                    longitude=stop.coordinates.longitude,
                    priority=stop.priority,
                    arrival=stop.arrival.isoformat(),
                    service_start=stop.service_start.isoformat(),
                    service_end=stop.service_end.isoformat(),
                    estimated_arrival=stop.service_start.isoformat(),
                    wait_seconds=stop.wait_seconds,
                    driving_seconds=stop.driving_seconds,
                    window_start=stop.window_start.isoformat() if stop.window_start else None,
                    window_end=stop.window_end.isoformat() if stop.window_end else None,
                    within_window=not stop.is_late,
                    late_by_seconds=stop.late_by_seconds,
                )
                for stop in route.stops
            ],
            stop_count=route.delivery_count,
            distance_meters=route.distance_meters,
            distance_km=route.distance_km,
            duration_seconds=route.duration_seconds,
            duration_minutes=route.duration_minutes,
            driving_seconds=round(route.duration_seconds - route.total_wait_seconds, 1),
            waiting_seconds=route.total_wait_seconds,
            estimated_return=route.return_time.isoformat() if route.return_time else None,
            capacity=CapacityUsageResponse(
                capacity_kg=capacity.weight_kg,
                used_kg=route.capacity_used_kg,
                remaining_kg=round(capacity.weight_kg - route.capacity_used_kg, 3)
                if capacity.weight_kg > 0
                else None,
                utilization_percent=round(route.capacity_used_kg / capacity.weight_kg * 100.0, 1)
                if capacity.weight_kg > 0
                else None,
                capacity_volume_m3=capacity.volume_m3,
                used_volume_m3=route.capacity_used_m3,
                remaining_volume_m3=round(capacity.volume_m3 - route.capacity_used_m3, 3)
                if capacity.volume_m3 > 0
                else None,
            ),
            has_time_window_violations=any(stop.is_late for stop in route.stops),
            geometry=route.geometry,
            bounds=route.bounds,
        )

    @staticmethod
    def _unassigned(item: UnassignedDelivery) -> UnassignedDeliveryResponse:
        return UnassignedDeliveryResponse(
            delivery_id=item.delivery_id,
            tracking_number=item.tracking_number,
            customer_name=item.customer_name,
            address=item.address,
            priority=item.priority,
            weight_kg=item.weight_kg,
            reason=item.reason,
        )

    @staticmethod
    def _violation(v) -> ConstraintViolationResponse:
        return ConstraintViolationResponse(
            kind=v.kind.value if isinstance(v.kind, ViolationKind) else str(v.kind),
            subject=v.subject,
            message=v.message,
            delivery_id=v.delivery_id,
            vehicle_id=v.vehicle_id,
        )

    def _infeasible_response(
        self,
        *,
        optimization_id: str,
        problem: OptimizationProblem,
        result: OptimizationResult,
        warnings: list[str],
    ) -> OptimizationResponse:
        """An infeasible answer is still a well-formed, informative response."""
        violations = result.violations
        message = result.message or "Route could not satisfy all delivery constraints."

        if result.reason is InfeasibilityReason.INSUFFICIENT_CAPACITY:
            message = (
                "Optimization could not find a feasible solution because available vehicle "
                "capacity is insufficient."
            )
        elif result.reason is InfeasibilityReason.DELIVERY_EXCEEDS_CAPACITY:
            message = (
                "Optimization could not find a feasible solution because at least one delivery "
                "is heavier than the largest available vehicle."
            )
        elif result.reason is InfeasibilityReason.IMPOSSIBLE_TIME_WINDOWS:
            message = "Route could not satisfy all delivery constraints."

        return OptimizationResponse(
            optimization_id=optimization_id,
            status=OptimizationStatus.INFEASIBLE,
            message=message,
            provider=problem.routing_provider,
            profile=problem.profile,
            summary=OptimizationSummaryResponse(
                total_distance_meters=0.0,
                total_distance_km=0.0,
                total_duration_seconds=0.0,
                total_duration_minutes=0.0,
                vehicles_available=len(problem.vehicles),
                vehicles_used=0,
                deliveries_eligible=len(problem.deliveries),
                deliveries_assigned=0,
                deliveries_unassigned=len(problem.deliveries),
                total_demand_kg=problem.total_demand_kg,
                total_demand_m3=problem.total_demand_m3,
                total_capacity_kg=problem.total_capacity_kg,
                total_capacity_m3=problem.total_capacity_m3,
                constraints_enforced=problem.enforced_dimensions,
            ),
            routes=[],
            unassigned=[
                self._unassigned(
                    UnassignedDelivery(
                        delivery_id=d.delivery_id,
                        tracking_number=d.tracking_number,
                        customer_name=d.customer_name,
                        address=d.address,
                        priority=d.priority,
                        weight_kg=d.weight_kg,
                        reason=message,
                    )
                )
                for d in problem.deliveries
            ],
            violations=[self._violation(v) for v in violations],
            baseline=None,
            solver=SolverDiagnosticsResponse(
                objective_value=result.diagnostics.objective_value,
                wall_time_ms=result.diagnostics.wall_time_ms,
                vehicles_available=result.diagnostics.vehicles_available,
                matrix_nodes=result.diagnostics.matrix_nodes,
                matrix_source=result.diagnostics.matrix_source,
                matrix_degraded=result.diagnostics.matrix_degraded,
                time_limit_seconds=result.diagnostics.time_limit_seconds,
                enforced_constraints=problem.enforced_dimensions,
                objective="minimize_total_travel_distance",
            ),
            warnings=warnings,
            computed_at=datetime.now(timezone.utc).isoformat(),
        )


def _percent_saved(baseline: float, optimized: float) -> float:
    if baseline <= 0:
        return 0.0
    return round((baseline - optimized) / baseline * 100.0, 1)


optimization_service = OptimizationService()

__all__ = ["MAX_MATRIX_NODES", "OptimizationService", "optimization_service"]
