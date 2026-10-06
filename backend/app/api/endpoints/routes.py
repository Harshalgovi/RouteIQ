"""
Route preview API endpoint.

POST /api/v1/routes/preview

Calculates a real route (distance, duration, geometry) through the configured
routing provider. This phase does NOT optimise stop order — that is a later
phase — so the endpoint is explicitly named "preview".
"""

from fastapi import APIRouter, status

from app.schemas.route import RoutePreviewRequest, RoutePreviewResponse
from app.services.routing.registry import get_routing_service_info
from app.services.route_preview_service import route_preview_service
from app.api.errors import provider_error_to_http

router = APIRouter(prefix="/routes", tags=["Routes"])


@router.post(
    "/preview",
    response_model=RoutePreviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Preview a real route between an origin, destination and optional stops",
    responses={
        404: {"description": "No route or no geocoding match was found"},
        422: {"description": "Invalid coordinates or missing location information"},
        429: {"description": "Routing provider rate limit reached"},
        502: {"description": "Routing provider unavailable or returned an error"},
        504: {"description": "Routing provider timed out"},
    },
)
async def preview_route(payload: RoutePreviewRequest):
    """
    Origin + destination + optional intermediate stops
        -> routing provider
        -> distance, travel time, route geometry
        -> frontend map

    Stop order is exactly as supplied by the caller.
    """
    try:
        return await route_preview_service.preview(payload)
    except Exception as exc:  # noqa: BLE001 — normalised below, never leaked
        raise provider_error_to_http(exc) from None


@router.get("/providers", summary="Routing provider metadata")
def routing_providers():
    """Diagnostics for the frontend — provider name, supported profiles, keys."""
    return get_routing_service_info()
