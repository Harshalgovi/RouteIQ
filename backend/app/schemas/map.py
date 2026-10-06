"""
Pydantic schemas for the map provider configuration API.
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class TileStyleResponse(BaseModel):
    id: str
    name: str
    url: str
    attribution: str
    max_zoom: int = 19
    min_zoom: int = 1
    subdomains: str = "abc"
    scheme: str = "light"
    # Class the frontend applies to the Leaflet tile pane. Lets the same tiles
    # back a light and a dark basemap without a second tile provider.
    css_class: Optional[str] = None


class MapViewResponse(BaseModel):
    latitude: float
    longitude: float
    zoom: int


class MapAttributionResponse(BaseModel):
    label: str
    url: Optional[str] = None


class MapProviderInfo(BaseModel):
    """Everything the frontend needs to render a real basemap."""

    provider: str
    name: str
    requires_api_key: bool = False
    configured: bool
    supported: List[str] = Field(default_factory=list)
    message: Optional[str] = None
    default_style: str
    styles: List[TileStyleResponse]
    default_view: MapViewResponse
    attribution: List[MapAttributionResponse] = Field(default_factory=list)


class MapProviderBundle(BaseModel):
    """Single call that returns basemap + routing + geocoding provider metadata."""

    map: MapProviderInfo
    routing: dict
    geocoding: dict
