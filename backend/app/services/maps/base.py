"""
MapProvider abstraction.

Describes *which basemap data* the frontend should render. Tile descriptors are
resolved on the backend so a provider swap (OpenStreetMap -> MapTiler ->
self-hosted tiles) is a configuration change, not a frontend rewrite.

The frontend talks to ``/api/v1/maps/config`` and renders whatever it receives.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class TileStyle:
    """A named basemap style backed by XYZ raster tiles."""

    id: str
    name: str
    url: str
    attribution: str
    max_zoom: int = 19
    min_zoom: int = 1
    subdomains: str = "abc"
    #: Preferred light/dark context so route styling stays readable.
    scheme: str = "light"
    #: Optional class the frontend puts on the tile pane. Lets one set of OSM
    #: tiles back both a light and a dark basemap, so no third-party tile
    #: provider (and therefore no extra key or attribution) is required.
    css_class: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "attribution": self.attribution,
            "max_zoom": self.max_zoom,
            "min_zoom": self.min_zoom,
            "subdomains": self.subdomains,
            "scheme": self.scheme,
            "css_class": self.css_class,
        }


@dataclass(frozen=True)
class MapView:
    """Initial viewport for a freshly mounted map."""

    latitude: float
    longitude: float
    zoom: int = 12

    def as_dict(self) -> dict:
        return {"latitude": self.latitude, "longitude": self.longitude, "zoom": self.zoom}


@dataclass(frozen=True)
class ProviderAttribution:
    label: str
    url: Optional[str] = None


class MapProvider(ABC):
    """Contract every basemap provider implementation must satisfy."""

    provider_id: str = "abstract"
    provider_name: str = "Abstract Map Provider"
    requires_api_key: bool = False

    @abstractmethod
    def get_styles(self) -> list[TileStyle]:
        """All basemap styles this provider can serve."""

    @abstractmethod
    def default_style_id(self) -> str:
        """Style id the frontend should select on first load."""

    def default_view(self) -> MapView:
        """Fallback viewport. Providers may override with a better default."""
        return MapView(latitude=0.0, longitude=0.0, zoom=2)

    def get_style(self, style_id: str) -> TileStyle:
        for style in self.get_styles():
            if style.id == style_id:
                return style
        return self.get_styles()[0]

    def attribution(self) -> list[ProviderAttribution]:
        return [ProviderAttribution(label=f"Map data: {self.provider_name}")]

    def describe(self) -> dict:
        """Full provider payload consumed by the frontend map layer."""
        return {
            "provider": self.provider_id,
            "name": self.provider_name,
            "requires_api_key": self.requires_api_key,
            "configured": True,
            "default_style": self.default_style_id(),
            "styles": [style.as_dict() for style in self.get_styles()],
            "default_view": self.default_view().as_dict(),
            "attribution": [
                {"label": item.label, "url": item.url} for item in self.attribution()
            ],
        }
