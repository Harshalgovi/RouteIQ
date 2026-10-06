"""
Repository for Vehicle data access.

All database I/O for vehicles lives here — keep business logic in services/.
"""

from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleUpdate


class VehicleRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[Vehicle]:
        return db.query(Vehicle).offset(skip).limit(limit).all()

    def get_by_id(self, db: Session, vehicle_id: int) -> Optional[Vehicle]:
        return db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()

    def get_by_vehicle_number(self, db: Session, vehicle_number: str) -> Optional[Vehicle]:
        return db.query(Vehicle).filter(Vehicle.vehicle_number == vehicle_number).first()

    def get_tracked(self, db: Session) -> List[Vehicle]:
        """Return vehicles where tracking_enabled = True."""
        return db.query(Vehicle).filter(Vehicle.tracking_enabled == True).all()  # noqa: E712

    def create(self, db: Session, data: VehicleCreate) -> Vehicle:
        vehicle = Vehicle(**data.model_dump())
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)
        return vehicle

    def update(self, db: Session, vehicle: Vehicle, data: VehicleUpdate) -> Vehicle:
        update_dict = data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(vehicle, field, value)
        db.commit()
        db.refresh(vehicle)
        return vehicle

    def set_tracking(self, db: Session, vehicle: Vehicle, enabled: bool) -> Vehicle:
        vehicle.tracking_enabled = enabled
        db.commit()
        db.refresh(vehicle)
        return vehicle

    def delete(self, db: Session, vehicle: Vehicle) -> None:
        db.delete(vehicle)
        db.commit()


vehicle_repository = VehicleRepository()
