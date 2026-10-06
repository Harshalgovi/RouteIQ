"""
Geocoding REST API endpoints.

Geocoding always runs on the backend — the frontend never calls a geocoding
provider directly, and no provider credentials ever leave the server.
"""

from fastapi import APIRouter, Query, status

from app.api.errors import provider_error_to_http
from app.schemas.geocoding import (
    GeocodeRequest,
    GeocodeResponse,
    GeocodingProviderInfo,
)
from app.services.geocoding.base import Coordinates
from app.services.geocoding.registry import get_geocoding_service, get_geocoding_service_info

router = APIRouter(prefix="/geocoding", tags=["Geocoding"])


@router.post(
    "/geocode",
    response_model=GeocodeResponse,
    status_code=status.HTTP_200_OK,
    summary="Resolve an address to latitude/longitude",
    responses={
        404: {"description": "No coordinates found for the address"},
        422: {"description": "Invalid address"},
        429: {"description": "Geocoding provider rate limit reached"},
        502: {"description": "Geocoding provider unavailable or returned an error"},
        504: {"description": "Geocoding provider timed out"},
    },
)
async def geocode_address(payload: GeocodeRequest):
    """
    Address -> geocoding service -> latitude + longitude.

    Returns 404 when the provider is healthy but has no match for the address.
    """
    service = get_geocoding_service()
    try:
        result = await service.geocode(
            payload.address,
            country_codes=payload.country_codes,
            language=payload.language,
        )
    except Exception as exc:  # noqa: BLE001 — normalised, never leaked
        raise provider_error_to_http(exc) from None

    if result is None:
        from app.services.providers.errors import ProviderNotFoundError

        raise provider_error_to_http(
            ProviderNotFoundError(
                f"No coordinates were found for '{payload.address}'. "
                "Check the address and try again.",
                provider=service.provider_id,
            )
        )

    return GeocodeResponse(
        latitude=result.coordinates.latitude,
        longitude=result.coordinates.longitude,
        formatted_address=result.formatted_address,
        display_name=result.display_name,
        provider=result.provider,
        provider_reference=result.provider_reference,
        bounding_box=list(result.bounding_box) if result.bounding_box else None,
        cached=result.cached,
    )


@router.post(
    "/reverse",
    summary="Resolve coordinates to a human-readable address",
    responses={
        501: {"description": "Provider does not support reverse lookups"},
        429: {"description": "Geocoding provider rate limit reached"},
        502: {"description": "Geocoding provider unavailable or returned an error"},
        504: {"description": "Geocoding provider timed out"},
    },
)
async def reverse_geocode(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
):
    """Best-effort reverse lookup. Providers without support return 501."""
    service = get_geocoding_service()
    try:
        address = await service.reverse_geocode(
            Coordinates(latitude=latitude, longitude=longitude)
        )
    except NotImplementedError:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="The configured geocoding provider does not support reverse lookups.",
        ) from None
    except Exception as exc:  # noqa: BLE001
        raise provider_error_to_http(exc) from None

    return {
        "address": address,
        "latitude": latitude,
        "longitude": longitude,
        "provider": service.provider_id,
    }


@router.get(
    "/providers",
    response_model=GeocodingProviderInfo,
    summary="Geocoding provider metadata",
)
def geocoding_providers():
    """Diagnostics for the frontend — provider name and whether a key is needed."""
    return get_geocoding_service_info()
