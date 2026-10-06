"""
Repository for TrackingRecord data access.
"""

from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.tracking import TrackingRecord
from app.schemas.tracking import TrackingRecordCreate


class TrackingRepository:
    def get_latest_for_vehicle(self, db: Session, vehicle_id: int) -> Optional[TrackingRecord]:
        return (
            db.query(TrackingRecord)
            .filter(TrackingRecord.vehicle_id == vehicle_id)
            .order_by(TrackingRecord.timestamp.desc())
            .first()
        )

    def get_history_for_vehicle(
        self, db: Session, vehicle_id: int, limit: int = 50
    ) -> List[TrackingRecord]:
        return (
            db.query(TrackingRecord)
            .filter(TrackingRecord.vehicle_id == vehicle_id)
            .order_by(TrackingRecord.timestamp.desc())
            .limit(limit)
            .all()
        )

    def create(self, db: Session, data: TrackingRecordCreate) -> TrackingRecord:
        record = TrackingRecord(**data.model_dump())
        db.add(record)
        db.commit()
        db.refresh(record)
        return record


tracking_repository = TrackingRepository()
