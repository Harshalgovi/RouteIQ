"""
Pydantic schemas for Driver validation and serialization.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class DriverBase(BaseModel):
    name: str
    phone: Optional[str] = None
    status: str = "active"


class DriverCreate(DriverBase):
    pass


class DriverUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None


class DriverResponse(DriverBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
