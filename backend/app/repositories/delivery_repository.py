"""
Repository for Delivery data access.
"""

from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.delivery import Delivery
from app.schemas.delivery import DeliveryCreate, DeliveryUpdate


class DeliveryRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[Delivery]:
        return db.query(Delivery).offset(skip).limit(limit).all()

    def get_by_id(self, db: Session, delivery_id: int) -> Optional[Delivery]:
        return db.query(Delivery).filter(Delivery.id == delivery_id).first()

    def get_by_tracking_number(self, db: Session, tracking_number: str) -> Optional[Delivery]:
        return db.query(Delivery).filter(Delivery.tracking_number == tracking_number).first()

    def get_by_vehicle(self, db: Session, vehicle_id: int) -> List[Delivery]:
        return db.query(Delivery).filter(Delivery.assigned_vehicle_id == vehicle_id).all()

    def create(self, db: Session, data: DeliveryCreate) -> Delivery:
        delivery = Delivery(**data.model_dump())
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        return delivery

    def update(self, db: Session, delivery: Delivery, data: DeliveryUpdate) -> Delivery:
        update_dict = data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(delivery, field, value)
        db.commit()
        db.refresh(delivery)
        return delivery

    def delete(self, db: Session, delivery: Delivery) -> None:
        db.delete(delivery)
        db.commit()


delivery_repository = DeliveryRepository()
