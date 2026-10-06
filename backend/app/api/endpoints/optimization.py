"""
Route optimisation API endpoint.

POST /api/v1/routes/optimize

Solves the Vehicle Routing Problem with Google OR-Tools over real vehicles and
real deliveries, using a real road distance/duration matrix from the configured
routing provider. The handler does no optimisation work itself — it delegates to
`app.services.optimization.service` and translates the outcome to HTTP.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.errors import provider_error_to_http
from app.schemas.optimization import OptimizationRequest, OptimizationResponse
from app.services.optimization.constraints import OptimizationInputError
from app.services.optimization.models import (
    InfeasibilityReason,
    OptimizationStatus,
)
from app.services.optimization.service import optimization_service

logger = logging.getLogger("routeiq.api.routes.optimize")

router = APIRouter(prefix="/routes", tags=["Optimization"])

#: Spelled numerically to stay compatible across Starlette versions.
HTTP_422 = 422

#: Reasons where the inputs were valid but no feasible plan exists. Checked
#: first, so an infeasibility always reports the same way whether it was caught
#: by the pre-flight checks or by the solver itself.
_INFEASIBLE_REASON_STATUS = {
    InfeasibilityReason.INSUFFICIENT_CAPACITY: status.HTTP_409_CONFLICT,
    InfeasibilityReason.DELIVERY_EXCEEDS_CAPACITY: status.HTTP_409_CONFLICT,
    InfeasibilityReason.IMPOSSIBLE_TIME_WINDOWS: status.HTTP_409_CONFLICT,
    InfeasibilityReason.CONSTRAINTS_CONFLICT: status.HTTP_409_CONFLICT,
}

#: Reasons that describe a bad *request* rather than an unsolvable problem.
_REQUEST_REASON_STATUS = {
    InfeasibilityReason.INVALID_DELIVERY_IDS: status.HTTP_404_NOT_FOUND,
    InfeasibilityReason.MISSING_COORDINATES: HTTP_422,
    InfeasibilityReason.INVALID_COORDINATES: HTTP_422,
    InfeasibilityReason.MISSING_VEHICLE_POSITIONS: HTTP_422,
    InfeasibilityReason.NO_VEHICLES: HTTP_422,
    InfeasibilityReason.NO_DELIVERIES: HTTP_422,
    InfeasibilityReason.NO_ROUTE_AVAILABLE: HTTP_422,
}


@router.post(
    "/optimize",
    response_model=OptimizationResponse,
    status_code=status.HTTP_200_OK,
    summary="Solve the vehicle routing problem across real vehicles and deliveries",
    responses={
        404: {"description": "An unknown delivery or vehicle id was supplied"},
        409: {"description": "No feasible solution satisfies the constraints"},
        422: {"description": "Missing coordinates, no available vehicles, or bad input"},
        429: {"description": "Routing provider rate limit reached"},
        502: {"description": "Routing provider unavailable or returned an error"},
        503: {"description": "The OR-Tools routing solver is unavailable on this server"},
        504: {"description": "Routing provider timed out"},
    },
)
async def optimize_routes(
    payload: OptimizationRequest,
    db: Session = Depends(get_db),
):
    """
    Deliveries + vehicles + constraints
        -> eligibility filtering
        -> real travel matrix from the routing provider
        -> OR-Tools solve (capacity, time windows, availability)
        -> validated per-vehicle routes

    A plan is never returned unless it satisfies the constraints. When the
    problem cannot be solved, the response explains which constraint blocked it
    and every delivery is reported as unassigned.
    """
    try:
        result = await optimization_service.optimize(db, payload)
    except OptimizationInputError as exc:
        logger.info("[optimize] rejected: %s (%s)", exc.user_message, exc.reason.value)
        http_status = _INFEASIBLE_REASON_STATUS.get(
            exc.reason, _REQUEST_REASON_STATUS.get(exc.reason, HTTP_422)
        )
        raise HTTPException(status_code=http_status, detail=exc.user_message) from None
    except Exception as exc:  # noqa: BLE001 — normalised below, never leaked
        raise provider_error_to_http(exc) from None

    # "No feasible plan" is the same outcome whether the pre-flight checks or the
    # solver detected it, so both must report the same status code. The body is
    # still returned in full: the caller gets the summary and the unassigned list.
    # Compared by value because the response model narrows status to a plain str.
    if result.status == OptimizationStatus.INFEASIBLE:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=jsonable_encoder(result),
        )
    return result


@router.get(
    "/optimize/capabilities",
    summary="What the optimisation engine supports right now",
)
async def optimization_capabilities():
    """
    Engine metadata for the frontend.

    States plainly which constraints are enforced and that the objective is
    currently distance-only, so the UI never implies capabilities that do not
    exist yet.
    """
    from app.services.routing.registry import get_routing_service_info

    routing = get_routing_service_info()
    return {
        "engine": "google_or_tools",
        "solver": "routing_model",
        "objective": "minimize_total_travel_distance",
        "objective_is_extensible": True,
        "constraints_enforced": [
            "vehicle_capacity_weight",
            "vehicle_capacity_volume",
            "delivery_time_windows",
            "vehicle_availability",
            "single_assignment_per_delivery",
        ],
        "constraints_not_yet_implemented": [
            "driver_working_hours",
            "traffic_prediction",
            "fuel_cost",
            "vehicle_operating_cost",
            "pickup_and_delivery_pairs",
            "multi_depot",
        ],
        "supports_partial_plans": True,
        "routing_provider": routing.get("provider"),
        "matrix_supported_by_provider": routing.get("supports_matrix", False),
    }


__all__ = ["OptimizationStatus", "router"]
