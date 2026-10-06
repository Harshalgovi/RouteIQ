"""
SQLAlchemy model for vehicle GPS tracking records in RouteIQ.

Each row is a single telemetry snapshot for a vehicle.
Future phase: rows will be written by a WebSocket GPS listener.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.core.database import Base


class TrackingRecord(Base):
    """
    Immutable append-only telemetry log.
    Does not use TimestampMixin (has its own timestamp column).
    """

    __tablename__ = "tracking_records"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    vehicle_id = Column(
        Integer,
        ForeignKey("vehicles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    speed = Column(Float, nullable=True)           # km/h; null if not reported

    timestamp = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    # Relationship back to vehicle
    vehicle = relationship("Vehicle", back_populates="tracking_records", lazy="joined")

    __table_args__ = (
        Index("ix_tracking_vehicle_time", "vehicle_id", "timestamp"),
    )
