"""
Pydantic schemas for Delivery validation and serialization.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class DeliveryBase(BaseModel):
    tracking_number: str
    customer_name: str
    phone: Optional[str] = None
    address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    package_weight: float = 1.0
    volume_m3: float = 0.1
    time_window_start: Optional[datetime] = None
    time_window_end: Optional[datetime] = None
    priority: str = "normal"
    status: str = "pending"
    notes: Optional[str] = None
    assigned_vehicle_id: Optional[int] = None


class DeliveryCreate(DeliveryBase):
    pass


class DeliveryUpdate(BaseModel):
    tracking_number: Optional[str] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    package_weight: Optional[float] = None
    volume_m3: Optional[float] = None
    time_window_start: Optional[datetime] = None
    time_window_end: Optional[datetime] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    assigned_vehicle_id: Optional[int] = None


class DeliveryResponse(DeliveryBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
