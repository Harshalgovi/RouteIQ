"""
Map provider abstraction.

Public surface:
  get_map_provider()      -> the configured MapProvider singleton
  get_map_provider_info() -> basemap payload consumed by the frontend
"""

from app.services.maps.base import MapProvider, MapView, TileStyle
from app.services.maps.registry import (
    SUPPORTED_PROVIDERS,
    get_map_provider,
    get_map_provider_info,
)

__all__ = [
    "MapProvider",
    "MapView",
    "TileStyle",
    "SUPPORTED_PROVIDERS",
    "get_map_provider",
    "get_map_provider_info",
]
