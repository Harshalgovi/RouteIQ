"""
Pydantic schemas for health check responses.
"""

from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(default="ok", json_schema_extra={"example": "ok"})
    app: str = Field(default="RouteIQ", json_schema_extra={"example": "RouteIQ"})
    version: str = Field(default="0.1.0", json_schema_extra={"example": "0.1.0"})
    environment: str = Field(default="development", json_schema_extra={"example": "development"})
    database: str = Field(default="connected", json_schema_extra={"example": "connected"})
    details: Optional[Dict[str, Any]] = None
