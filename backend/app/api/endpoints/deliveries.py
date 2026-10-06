"""
Deliveries REST API endpoints.
"""

from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.delivery import DeliveryCreate, DeliveryUpdate, DeliveryResponse
from app.services.delivery_service import delivery_service

router = APIRouter(prefix="/deliveries", tags=["Deliveries"])


@router.get("", response_model=List[DeliveryResponse], summary="List all deliveries")
def list_deliveries(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Return all delivery orders with optional pagination."""
    return delivery_service.list_deliveries(db, skip=skip, limit=limit)


@router.post("", response_model=DeliveryResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a delivery",
             responses={
                 404: {"description": "Address could not be geocoded"},
                 422: {"description": "Validation error"},
                 429: {"description": "Geocoding provider rate limit reached"},
                 502: {"description": "Geocoding provider unavailable"},
                 504: {"description": "Geocoding provider timed out"},
             })
async def create_delivery(data: DeliveryCreate, db: Session = Depends(get_db)):
    """
    Create a new delivery order. Returns 409 if tracking_number already exists.

    If latitude/longitude are omitted, the backend geocodes the address with the
    configured provider and stores the resolved coordinates.
    """
    return await delivery_service.create_delivery(db, data)


@router.get("/{delivery_id}", response_model=DeliveryResponse, summary="Get a single delivery")
def get_delivery(delivery_id: int, db: Session = Depends(get_db)):
    """Retrieve a specific delivery by its integer ID."""
    return delivery_service.get_delivery(db, delivery_id)


@router.put("/{delivery_id}", response_model=DeliveryResponse, summary="Update a delivery")
async def update_delivery(delivery_id: int, data: DeliveryUpdate, db: Session = Depends(get_db)):
    """Partially update a delivery. Only provided fields are updated."""
    return await delivery_service.update_delivery(db, delivery_id, data)


@router.delete("/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Delete a delivery")
def delete_delivery(delivery_id: int, db: Session = Depends(get_db)):
    """Permanently remove a delivery order."""
    delivery_service.delete_delivery(db, delivery_id)


@router.post("/{delivery_id}/geocode", response_model=DeliveryResponse,
             summary="Re-geocode a delivery address",
             responses={
                 404: {"description": "Address could not be geocoded"},
                 429: {"description": "Geocoding provider rate limit reached"},
                 502: {"description": "Geocoding provider unavailable"},
                 504: {"description": "Geocoding provider timed out"},
             })
async def geocode_delivery(delivery_id: int, db: Session = Depends(get_db)):
    """
    Resolve the delivery's stored address to coordinates and persist them.
    Useful after editing an address or when coordinates are missing.
    """
    return await delivery_service.geocode_delivery(db, delivery_id)
