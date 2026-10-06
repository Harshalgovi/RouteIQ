"""
Drivers REST API endpoints.
"""

from typing import Dict, List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.driver import DriverCreate, DriverUpdate, DriverResponse
from app.services.driver_service import driver_service

router = APIRouter(prefix="/drivers", tags=["Drivers"])


@router.get("", response_model=List[DriverResponse], summary="List all drivers")
def list_drivers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Return all registered drivers."""
    return driver_service.list_drivers(db, skip=skip, limit=limit)


@router.post("", response_model=DriverResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a driver")
def create_driver(data: DriverCreate, db: Session = Depends(get_db)):
    """Register a new fleet driver."""
    return driver_service.create_driver(db, data)


@router.get("/{driver_id}", response_model=DriverResponse, summary="Get a single driver")
def get_driver(driver_id: int, db: Session = Depends(get_db)):
    """Retrieve a specific driver by their ID."""
    return driver_service.get_driver(db, driver_id)


@router.put("/{driver_id}", response_model=DriverResponse, summary="Update a driver")
def update_driver(driver_id: int, data: DriverUpdate, db: Session = Depends(get_db)):
    """Partially update a driver profile."""
    return driver_service.update_driver(db, driver_id, data)


@router.delete(
    "/{driver_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a driver",
    responses={404: {"description": "Driver does not exist"}},
)
def delete_driver(driver_id: int, db: Session = Depends(get_db)):
    """
    Delete a driver.

    Any vehicle currently assigned to this driver is released (its `driver_id`
    becomes null) rather than deleted, so deleting a driver can never destroy a
    truck or its delivery history.
    """
    driver_service.delete_driver(db, driver_id)


@router.get("/{driver_id}/vehicles", summary="List vehicles driven by a driver")
def list_driver_vehicles(driver_id: int, db: Session = Depends(get_db)) -> List[Dict]:
    """Return the vehicles this driver is currently assigned."""
    driver = driver_service.get_driver(db, driver_id)
    return [
        {"id": vehicle.id, "vehicle_number": vehicle.vehicle_number, "name": vehicle.name}
        for vehicle in driver.vehicles
    ]
