"""
SQLAlchemy model for Vehicle entities in RouteIQ.

Fields align with the frontend Vehicle type and the RouteIQ spec.
"""

from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class Vehicle(Base, TimestampMixin):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # Display / identity fields
    vehicle_number = Column(String(30), unique=True, nullable=False, index=True)  # e.g. V-101
    name = Column(String(100), nullable=False)
    license_plate = Column(String(50), unique=True, nullable=False, index=True)
    vehicle_type = Column(String(50), nullable=False, default="van")  # van | truck | bike | refrigerated

    # Capacity
    capacity_kg = Column(Float, nullable=False, default=1000.0)
    capacity_volume_m3 = Column(Float, nullable=False, default=10.0)

    # Operational state: available | active | delayed | offline
    status = Column(String(50), default="available", nullable=False, index=True)

    # Tracking state
    # NOTE: tracking_enabled means the *operator* has enabled tracking for this vehicle.
    # It does NOT mean a live GPS signal is available (that is a future WebSocket phase).
    tracking_enabled = Column(Boolean, default=False, nullable=False, index=True)

    # Last known location (static seed data / future GPS update target)
    current_latitude = Column(Float, nullable=True)
    current_longitude = Column(Float, nullable=True)

    # Driver FK (optional assignment)
    driver_id = Column(Integer, ForeignKey("drivers.id", ondelete="SET NULL"), nullable=True, index=True)

    # Relationships
    driver = relationship("Driver", back_populates="vehicles", lazy="joined")
    deliveries = relationship("Delivery", back_populates="vehicle", lazy="select")
    tracking_records = relationship("TrackingRecord", back_populates="vehicle", lazy="select",
                                   cascade="all, delete-orphan")

    # Composite index useful for fleet-status queries
    __table_args__ = (
        Index("ix_vehicles_status_tracking", "status", "tracking_enabled"),
    )
