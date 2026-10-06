"""
Central API router registration.

All endpoint routers are mounted here without an additional prefix —
the API_V1_STR prefix (/api/v1) is applied in main.py.
"""

from fastapi import APIRouter
from app.api.endpoints import (
    health,
    vehicles,
    deliveries,
    drivers,
    tracking,
    routes,
    geocoding,
    maps,
    optimization,
)

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(vehicles.router)
api_router.include_router(deliveries.router)
api_router.include_router(drivers.router)
api_router.include_router(tracking.router)
api_router.include_router(routes.router)
api_router.include_router(optimization.router)
api_router.include_router(geocoding.router)
api_router.include_router(maps.router)
