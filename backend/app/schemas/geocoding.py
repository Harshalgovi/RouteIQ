"""
Pydantic schemas for the geocoding API.
"""

from typing import List, Optional
from pydantic import BaseModel, Field, model_validator


class GeocodeRequest(BaseModel):
    address: str = Field(min_length=3, description="Free-form street address to resolve.")
    # Optional bias for ambiguous addresses, e.g. "us" or "us,ca".
    country_codes: Optional[str] = None
    language: Optional[str] = None

    @model_validator(mode="after")
    def strip_address(self) -> "GeocodeRequest":
        cleaned = self.address.strip()
        if len(cleaned) < 3:
            raise ValueError("Address must be at least 3 characters long.")
        object.__setattr__(self, "address", cleaned)
        return self


class GeocodeResponse(BaseModel):
    """Resolved address. Returned by POST /api/v1/geocoding/geocode."""

    latitude: float
    longitude: float
    formatted_address: Optional[str] = None
    display_name: Optional[str] = None
    provider: str
    provider_reference: Optional[str] = None
    bounding_box: Optional[List[float]] = None
    cached: bool = Field(
        default=False, description="True when served from the server-side cache."
    )


class ReverseGeocodeResponse(BaseModel):
    address: Optional[str]
    latitude: float
    longitude: float
    provider: str


class GeocodingProviderInfo(BaseModel):
    provider: str
    name: str
    requires_api_key: bool
    configured: bool
    supported: List[str]
    message: Optional[str] = None
