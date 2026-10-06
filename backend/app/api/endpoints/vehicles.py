"""
Vehicles REST API endpoints.
"""

from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.vehicle import VehicleCreate, VehicleUpdate, VehicleResponse
from app.services.vehicle_service import vehicle_service

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])


@router.get("", response_model=List[VehicleResponse], summary="List all vehicles")
def list_vehicles(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Return all fleet vehicles with optional pagination."""
    return vehicle_service.list_vehicles(db, skip=skip, limit=limit)


@router.post("", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a vehicle")
def create_vehicle(data: VehicleCreate, db: Session = Depends(get_db)):
    """Create a new fleet vehicle. Returns 409 if vehicle_number already exists."""
    return vehicle_service.create_vehicle(db, data)


@router.get("/{vehicle_id}", response_model=VehicleResponse, summary="Get a single vehicle")
def get_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    """Retrieve a specific vehicle by its integer ID."""
    return vehicle_service.get_vehicle(db, vehicle_id)


@router.put("/{vehicle_id}", response_model=VehicleResponse, summary="Update a vehicle")
def update_vehicle(vehicle_id: int, data: VehicleUpdate, db: Session = Depends(get_db)):
    """Partially update a vehicle. Only provided fields are updated."""
    return vehicle_service.update_vehicle(db, vehicle_id, data)


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Delete a vehicle")
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    """Permanently remove a vehicle from the fleet."""
    vehicle_service.delete_vehicle(db, vehicle_id)
