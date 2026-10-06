"""
OpenStreetMap basemap provider.

Every style here is served by the standard OpenStreetMap tile endpoint,
`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, which needs no API key and no
account. The dark control-center look is produced client-side with a CSS filter
on the tile pane rather than by switching to a third-party tile host, so there is
no CARTO/Google configuration to keep in sync and no extra attribution to show.

`attribution` still credits OpenStreetMap on both styles, as their tile usage
policy requires.
"""

from __future__ import annotations

from app.services.maps.base import MapProvider, MapView, ProviderAttribution, TileStyle

OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'


class OpenStreetMapProvider(MapProvider):
    provider_id = "openstreetmap"
    provider_name = "OpenStreetMap"
    requires_api_key = False

    def __init__(self, default_latitude: float = 0.0, default_longitude: float = 0.0,
                 default_zoom: int = 12) -> None:
        self._default_latitude = default_latitude
        self._default_longitude = default_longitude
        self._default_zoom = default_zoom

    def get_styles(self) -> list[TileStyle]:
        # Both styles point at the same OSM tiles. `css_class` tells the
        # frontend which filter to apply to the tile pane.
        return [
            TileStyle(
                id="dark",
                name="Dark",
                url=OSM_TILE_URL,
                attribution=OSM_ATTRIBUTION,
                max_zoom=19,
                scheme="dark",
                css_class="tiles-dark",
            ),
            TileStyle(
                id="standard",
                name="Standard",
                url=OSM_TILE_URL,
                attribution=OSM_ATTRIBUTION,
                max_zoom=19,
                scheme="light",
                css_class="tiles-light",
            ),
        ]

    def default_style_id(self) -> str:
        return "dark"

    def default_view(self) -> MapView:
        return MapView(
            latitude=self._default_latitude,
            longitude=self._default_longitude,
            zoom=self._default_zoom,
        )

    def attribution(self) -> list[ProviderAttribution]:
        return [
            ProviderAttribution(
                label="OpenStreetMap contributors",
                url="https://www.openstreetmap.org/copyright",
            )
        ]