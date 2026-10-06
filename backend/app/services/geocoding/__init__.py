"""
Geocoding service abstraction.

Public surface:
  get_geocoding_service()      -> the configured GeocodingService singleton
  get_geocoding_service_info() -> provider metadata for the frontend
"""

from app.services.geocoding.base import Coordinates, GeocodeResult, GeocodingService
from app.services.geocoding.registry import (
    SUPPORTED_PROVIDERS,
    get_geocoding_service,
    get_geocoding_service_info,
)

__all__ = [
    "Coordinates",
    "GeocodeResult",
    "GeocodingService",
    "SUPPORTED_PROVIDERS",
    "get_geocoding_service",
    "get_geocoding_service_info",
]
