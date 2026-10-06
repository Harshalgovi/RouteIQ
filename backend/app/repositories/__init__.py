"""
Repositories export package.
"""

from app.repositories.vehicle_repository import vehicle_repository, VehicleRepository
from app.repositories.driver_repository import driver_repository, DriverRepository
from app.repositories.delivery_repository import delivery_repository, DeliveryRepository
from app.repositories.tracking_repository import tracking_repository, TrackingRepository

__all__ = [
    "vehicle_repository",
    "VehicleRepository",
    "driver_repository",
    "DriverRepository",
    "delivery_repository",
    "DeliveryRepository",
    "tracking_repository",
    "TrackingRepository",
]
