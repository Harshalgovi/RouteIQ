"""
Map provider API endpoint.

GET /api/v1/maps/config

The frontend asks the backend which basemap to render. Changing provider is a
backend configuration change — the frontend simply renders what it receives.
"""

from fastapi import APIRouter

from app.api.errors import provider_error_to_http
from app.schemas.map import MapProviderBundle, MapProviderInfo
from app.services.geocoding.registry import get_geocoding_service_info
from app.services.maps.registry import get_map_provider_info
from app.services.routing.registry import get_routing_service_info

router = APIRouter(prefix="/maps", tags=["Maps"])


@router.get(
    "/config",
    response_model=MapProviderInfo,
    summary="Basemap provider configuration (tile styles, attribution, default view)",
)
def map_config():
    """Tile descriptors + attribution + initial viewport for the map layer."""
    try:
        return get_map_provider_info()
    except Exception as exc:  # noqa: BLE001
        raise provider_error_to_http(exc) from None


@router.get(
    "/providers",
    response_model=MapProviderBundle,
    summary="Map, routing and geocoding provider metadata in one call",
)
def map_providers():
    """Everything RouteIQ needs to describe its real map stack. No secrets."""
    return MapProviderBundle(
        map=get_map_provider_info(),
        routing=get_routing_service_info(),
        geocoding=get_geocoding_service_info(),
    )
