"""
Repository for Driver data access.
"""

from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.driver import Driver
from app.schemas.driver import DriverCreate, DriverUpdate


class DriverRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100) -> List[Driver]:
        return db.query(Driver).offset(skip).limit(limit).all()

    def get_by_id(self, db: Session, driver_id: int) -> Optional[Driver]:
        return db.query(Driver).filter(Driver.id == driver_id).first()

    def create(self, db: Session, data: DriverCreate) -> Driver:
        driver = Driver(**data.model_dump())
        db.add(driver)
        db.commit()
        db.refresh(driver)
        return driver

    def update(self, db: Session, driver: Driver, data: DriverUpdate) -> Driver:
        update_dict = data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(driver, field, value)
        db.commit()
        db.refresh(driver)
        return driver

    def delete(self, db: Session, driver: Driver) -> None:
        db.delete(driver)
        db.commit()


driver_repository = DriverRepository()
