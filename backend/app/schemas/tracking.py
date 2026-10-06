"""
Pydantic schemas for TrackingRecord validation and serialization.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class TrackingRecordCreate(BaseModel):
    vehicle_id: int
    latitude: float
    longitude: float
    speed: Optional[float] = None


class TrackingRecordResponse(BaseModel):
    id: int
    vehicle_id: int
    latitude: float
    longitude: float
    speed: Optional[float] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
