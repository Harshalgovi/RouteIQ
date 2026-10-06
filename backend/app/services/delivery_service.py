"""
Delivery service — business logic for delivery operations.

Geocoding lives here (not in the API layer and not in the repository):
when a delivery is created with an address but no coordinates, the configured
geocoding service resolves them and the coordinates are persisted.
"""

from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.errors import provider_error_to_http
from app.models.delivery import Delivery
from app.repositories.delivery_repository import delivery_repository
from app.schemas.delivery import DeliveryCreate, DeliveryUpdate
from app.services.geocoding.resolver import resolve_address
from app.services.providers.errors import ProviderError, ProviderNotFoundError


class DeliveryService:
    def list_deliveries(self, db: Session, skip: int = 0, limit: int = 100) -> list[Delivery]:
        return delivery_repository.get_all(db, skip=skip, limit=limit)

    def get_delivery(self, db: Session, delivery_id: int) -> Delivery:
        delivery = delivery_repository.get_by_id(db, delivery_id)
        if not delivery:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Delivery {delivery_id} not found.",
            )
        return delivery

    async def create_delivery(self, db: Session, data: DeliveryCreate) -> Delivery:
        existing = delivery_repository.get_by_tracking_number(db, data.tracking_number)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tracking number '{data.tracking_number}' already exists.",
            )

        payload = data.model_dump()
        latitude, longitude = await self._ensure_coordinates(
            address=data.address,
            latitude=payload.get("latitude"),
            longitude=payload.get("longitude"),
        )
        payload["latitude"] = latitude
        payload["longitude"] = longitude

        return delivery_repository.create(db, DeliveryCreate(**payload))

    async def update_delivery(self, db: Session, delivery_id: int, data: DeliveryUpdate) -> Delivery:
        delivery = self.get_delivery(db, delivery_id)
        update_dict = data.model_dump(exclude_unset=True)

        address_supplied = "address" in update_dict
        coords_supplied = "latitude" in update_dict or "longitude" in update_dict

        # Address changed but no new coordinates -> re-resolve the new address.
        if address_supplied and not coords_supplied:
            latitude, longitude = await self._ensure_coordinates(
                address=update_dict.get("address") or delivery.address,
                latitude=None,
                longitude=None,
            )
            update_dict["latitude"] = latitude
            update_dict["longitude"] = longitude

        return delivery_repository.update(db, delivery, DeliveryUpdate(**update_dict))

    def delete_delivery(self, db: Session, delivery_id: int) -> None:
        delivery = self.get_delivery(db, delivery_id)
        delivery_repository.delete(db, delivery)

    # -- Geocoding -----------------------------------------------------------

    async def geocode_delivery(self, db: Session, delivery_id: int) -> Delivery:
        """
        Re-resolve a delivery's coordinates from its stored address.

        Useful when an address was edited while coordinates were kept, or when
        geocoding was unavailable at creation time.
        """
        delivery = self.get_delivery(db, delivery_id)
        latitude, longitude = await self._ensure_coordinates(
            address=delivery.address,
            latitude=None,
            longitude=None,
        )
        delivery.latitude = latitude
        delivery.longitude = longitude
        db.commit()
        db.refresh(delivery)
        return delivery

    async def _ensure_coordinates(
        self,
        *,
        address: str,
        latitude: Optional[float],
        longitude: Optional[float],
    ) -> tuple[Optional[float], Optional[float]]:
        """
        Return usable coordinates, geocoding the address when required.

        Provider failures are translated into safe HTTP errors (504 timeout,
        429 rate limit, 502 unavailable, 404 no match) — never raw exceptions.
        """
        if latitude is not None and longitude is not None:
            return latitude, longitude

        try:
            result = await resolve_address(address)
        except HTTPException:
            raise
        except ProviderError as exc:
            raise provider_error_to_http(exc) from None

        if result is None:
            raise provider_error_to_http(
                ProviderNotFoundError(
                    f"No coordinates could be found for address '{address}'. "
                    "Provide latitude/longitude explicitly or correct the address.",
                )
            )

        return result.coordinates.latitude, result.coordinates.longitude


delivery_service = DeliveryService()
