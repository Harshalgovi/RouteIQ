"""
Driver service — business logic for driver operations.
"""

from typing import List, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.driver import Driver
from app.models.vehicle import Vehicle
from app.repositories.driver_repository import driver_repository
from app.schemas.driver import DriverCreate, DriverUpdate


class DriverService:
    def list_drivers(self, db: Session, skip: int = 0, limit: int = 100) -> List[Driver]:
        return driver_repository.get_all(db, skip=skip, limit=limit)

    def get_driver(self, db: Session, driver_id: int) -> Driver:
        driver = driver_repository.get_by_id(db, driver_id)
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Driver {driver_id} not found.",
            )
        return driver

    def create_driver(self, db: Session, data: DriverCreate) -> Driver:
        return driver_repository.create(db, data)

    def update_driver(self, db: Session, driver_id: int, data: DriverUpdate) -> Driver:
        driver = self.get_driver(db, driver_id)
        return driver_repository.update(db, driver, data)

    def delete_driver(self, db: Session, driver_id: int) -> Tuple[bool, List[str]]:
        """
        Remove a driver, unassigning any vehicles they were driving first.

        The `vehicles.driver_id` foreign key is `ON DELETE SET NULL`, so the
        database would drop the link silently. Clearing it in the same
        transaction makes the outcome explicit and lets the API report which
        vehicles became unassigned, rather than leaving an operator wondering
        why a truck quietly lost its driver.

        Returns the deletion flag and the affected vehicle numbers.
        """
        driver = self.get_driver(db, driver_id)
        assigned = (
            db.query(Vehicle)
            .filter(Vehicle.driver_id == driver.id)
            .order_by(Vehicle.vehicle_number)
            .all()
        )
        vehicle_numbers = [v.vehicle_number for v in assigned]
        for vehicle in assigned:
            vehicle.driver_id = None
        db.flush()
        driver_repository.delete(db, driver)
        return True, vehicle_numbers


driver_service = DriverService()
