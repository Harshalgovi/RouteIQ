"""
Core configuration and application settings for RouteIQ.
"""

from typing import List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import json


class Settings(BaseSettings):
    APP_NAME: str = "RouteIQ"
    APP_ENV: str = "development"
    VERSION: str = "0.1.0"
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"

    # BACKEND_CORS_ORIGINS is a list of origins (e.g. ['http://localhost:5173'])
    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, str) and v.startswith("["):
            return json.loads(v)
        return v

    # Database connection configuration (PostgreSQL default, SQLite local fallback)
    DATABASE_URL: str = "sqlite:///./routeiq.db"
    # Echo every SQL statement. Kept separate from DEBUG: application debug mode
    # is on in development, and routing it here buried the API log under
    # per-statement output that made real errors unreadable.
    SQL_ECHO: bool = False

    # ────────────────────────────────────────────────────────────────────────────
    # MAP PROVIDER (tile / basemap data)
    # ────────────────────────────────────────────────────────────────────────────
    # Logical provider id. Resolved by app.services.maps.registry.
    # Supported: openstreetmap (default). Swap providers without touching app code.
    MAP_PROVIDER: str = "openstreetmap"

    # Basemap style requested by the frontend when the map first mounts.
    # The resolved tile URLs + attribution always come from the backend.
    MAP_DEFAULT_STYLE: str = "dark"

    # Fallback viewport used when a provider has no better default.
    # Defaults to Bengaluru, Karnataka, India — RouteIQ's default geography.
    MAP_DEFAULT_LATITUDE: float = 12.9716
    MAP_DEFAULT_LONGITUDE: float = 77.5946
    MAP_DEFAULT_ZOOM: int = 11

    # ────────────────────────────────────────────────────────────────────────────
    # GEOCODING PROVIDER (address -> latitude/longitude)
    # ────────────────────────────────────────────────────────────────────────────
    # Logical provider id. Resolved by app.services.geocoding.registry.
    # Supported: nominatim (default, keyless OpenStreetMap Nominatim).
    GEOCODING_PROVIDER: str = "nominatim"

    GEOCODING_BASE_URL: str = "https://nominatim.openstreetmap.org"
    # Optional API key. Nominatim does not require one; providers such as
    # Google/Mapbox/Geoapify do. Never exposed to the frontend.
    GEOCODING_API_KEY: Optional[str] = None
    # Nominatim's usage policy requires an identifying User-Agent.
    GEOCODING_USER_AGENT: str = "RouteIQ/1.0 (delivery routing platform)"
    GEOCODING_LANGUAGE: str = "en"
    GEOCODING_COUNTRY_CODES: Optional[str] = None  # e.g. "us,ca"
    GEOCODING_TIMEOUT_SECONDS: float = 10.0
    # Minimum seconds between outbound geocoding requests (Nominatim: 1 req/s).
    GEOCODING_MIN_INTERVAL_SECONDS: float = 1.0
    GEOCODING_CACHE_TTL_SECONDS: int = 86400
    GEOCODING_CACHE_MAX_ENTRIES: int = 2048

    # ────────────────────────────────────────────────────────────────────────────
    # ROUTING PROVIDER (coordinates -> distance, duration, geometry)
    # ────────────────────────────────────────────────────────────────────────────
    # Logical provider id. Resolved by app.services.routing.registry.
    # Supported: osrm (default, keyless OpenStreetMap OSRM demo server).
    ROUTING_PROVIDER: str = "osrm"

    ROUTING_BASE_URL: str = "https://router.project-osrm.org"
    ROUTING_API_KEY: Optional[str] = None
    # OSRM profile segment: driving | walking | cycling
    ROUTING_PROFILE: str = "driving"
    ROUTING_TIMEOUT_SECONDS: float = 12.0
    ROUTING_MIN_INTERVAL_SECONDS: float = 0.0
    ROUTING_CACHE_TTL_SECONDS: int = 900
    ROUTING_CACHE_MAX_ENTRIES: int = 1024

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()
