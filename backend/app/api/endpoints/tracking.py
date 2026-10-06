"""
Tracking REST API endpoints.

IMPORTANT: This phase implements tracking STATE management only.
Real-time GPS signals and WebSocket streaming are future phases.
tracking_enabled = True means the operator has opted this vehicle into tracking.
It does NOT mean live coordinates are being streamed right now.

The map layer renders exactly the coordinates stored on the vehicle record —
nothing is simulated or randomised here.
"""

from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.vehicle import VehicleResponse, TrackingStateResponse
from app.services.vehicle_service import vehicle_service

router = APIRouter(prefix="/tracking", tags=["Tracking"])


@router.get("/vehicles", response_model=List[VehicleResponse],
            summary="List currently tracked vehicles")
def list_tracked_vehicles(db: Session = Depends(get_db)):
    """
    Return all vehicles with tracking_enabled = True.
    Use this to determine which vehicles the dashboard should display.
    """
    return vehicle_service.get_tracked_vehicles(db)


@router.get("/vehicles/{vehicle_id}", response_model=VehicleResponse,
            summary="Get tracking state for a vehicle")
def get_vehicle_tracking_state(vehicle_id: int, db: Session = Depends(get_db)):
    """
    Return full vehicle data including tracking_enabled state and last-known coordinates.
    Future GPS phase will update current_latitude / current_longitude in real-time.
    """
    return vehicle_service.get_vehicle(db, vehicle_id)


@router.post("/vehicles/{vehicle_id}/start", response_model=TrackingStateResponse,
             summary="Start tracking a vehicle")
def start_tracking(vehicle_id: int, db: Session = Depends(get_db)):
    """
    Enable operator tracking for a vehicle.
    Sets tracking_enabled = True and returns the updated tracking state.
    Idempotent: safe to call if already tracking.
    """
    vehicle = vehicle_service.start_tracking(db, vehicle_id)
    return vehicle_service.to_tracking_state(vehicle)


@router.post("/vehicles/{vehicle_id}/stop", response_model=TrackingStateResponse,
             summary="Stop tracking a vehicle")
def stop_tracking(vehicle_id: int, db: Session = Depends(get_db)):
    """
    Disable operator tracking for a vehicle.
    Sets tracking_enabled = False and returns the updated tracking state.
    Idempotent: safe to call if not currently tracking.
    """
    vehicle = vehicle_service.stop_tracking(db, vehicle_id)
    return vehicle_service.to_tracking_state(vehicle)
