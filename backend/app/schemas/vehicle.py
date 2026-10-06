"""
Pydantic schemas for Vehicle validation and serialization.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class VehicleBase(BaseModel):
    vehicle_number: str
    name: str
    license_plate: str
    vehicle_type: str = "van"
    capacity_kg: float = 1000.0
    capacity_volume_m3: float = 10.0
    status: str = "available"
    tracking_enabled: bool = False
    current_latitude: Optional[float] = None
    current_longitude: Optional[float] = None
    driver_id: Optional[int] = None


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    vehicle_number: Optional[str] = None
    name: Optional[str] = None
    license_plate: Optional[str] = None
    vehicle_type: Optional[str] = None
    capacity_kg: Optional[float] = None
    capacity_volume_m3: Optional[float] = None
    status: Optional[str] = None
    tracking_enabled: Optional[bool] = None
    current_latitude: Optional[float] = None
    current_longitude: Optional[float] = None
    driver_id: Optional[int] = None


class VehicleDriverNested(BaseModel):
    """Lightweight nested driver info embedded in vehicle responses."""
    id: int
    name: str
    phone: Optional[str] = None
    status: str

    model_config = ConfigDict(from_attributes=True)


class VehicleResponse(VehicleBase):
    id: int
    created_at: datetime
    updated_at: datetime
    driver: Optional[VehicleDriverNested] = None

    model_config = ConfigDict(from_attributes=True)


class TrackingStateResponse(BaseModel):
    """Returned by start/stop tracking endpoints."""
    vehicle_id: int
    vehicle_number: str
    tracking_enabled: bool
    status: str
    current_latitude: Optional[float] = None
    current_longitude: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)
