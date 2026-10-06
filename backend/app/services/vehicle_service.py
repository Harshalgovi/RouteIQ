"""
Vehicle service — business logic for vehicle operations.

Route handlers should call this service, not repositories directly.
"""

from typing import List
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.vehicle import Vehicle
from app.repositories.vehicle_repository import vehicle_repository
from app.schemas.vehicle import TrackingStateResponse, VehicleCreate, VehicleUpdate


class VehicleService:
    def list_vehicles(self, db: Session, skip: int = 0, limit: int = 100) -> List[Vehicle]:
        return vehicle_repository.get_all(db, skip=skip, limit=limit)

    def get_vehicle(self, db: Session, vehicle_id: int) -> Vehicle:
        vehicle = vehicle_repository.get_by_id(db, vehicle_id)
        if not vehicle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Vehicle {vehicle_id} not found.",
            )
        return vehicle

    def create_vehicle(self, db: Session, data: VehicleCreate) -> Vehicle:
        # Uniqueness check for vehicle_number
        existing = vehicle_repository.get_by_vehicle_number(db, data.vehicle_number)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A vehicle with number '{data.vehicle_number}' already exists.",
            )
        return vehicle_repository.create(db, data)

    def update_vehicle(self, db: Session, vehicle_id: int, data: VehicleUpdate) -> Vehicle:
        vehicle = self.get_vehicle(db, vehicle_id)
        return vehicle_repository.update(db, vehicle, data)

    def delete_vehicle(self, db: Session, vehicle_id: int) -> None:
        vehicle = self.get_vehicle(db, vehicle_id)
        vehicle_repository.delete(db, vehicle)

    def get_tracked_vehicles(self, db: Session) -> List[Vehicle]:
        return vehicle_repository.get_tracked(db)

    def start_tracking(self, db: Session, vehicle_id: int) -> Vehicle:
        vehicle = self.get_vehicle(db, vehicle_id)
        if vehicle.tracking_enabled:
            # Idempotent — already tracking, return current state
            return vehicle
        return vehicle_repository.set_tracking(db, vehicle, enabled=True)

    def stop_tracking(self, db: Session, vehicle_id: int) -> Vehicle:
        vehicle = self.get_vehicle(db, vehicle_id)
        if not vehicle.tracking_enabled:
            # Idempotent — already not tracking
            return vehicle
        return vehicle_repository.set_tracking(db, vehicle, enabled=False)

    def to_tracking_state(self, vehicle: Vehicle) -> TrackingStateResponse:
        """
        Project a vehicle onto the tracking-state contract.

        `current_latitude` / `current_longitude` are the coordinates currently
        stored in the database — the map renders these verbatim.
        """
        return TrackingStateResponse(
            vehicle_id=vehicle.id,
            vehicle_number=vehicle.vehicle_number,
            tracking_enabled=vehicle.tracking_enabled,
            status=vehicle.status,
            current_latitude=vehicle.current_latitude,
            current_longitude=vehicle.current_longitude,
        )


vehicle_service = VehicleService()
