"""
SQLAlchemy model for Delivery entities in RouteIQ.
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class Delivery(Base, TimestampMixin):
    __tablename__ = "deliveries"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tracking_number = Column(String(50), unique=True, nullable=False, index=True)

    # Recipient
    customer_name = Column(String(100), nullable=False)    # maps to frontend recipientName
    phone = Column(String(30), nullable=True)
    address = Column(String(255), nullable=False)

    # Geo-coordinates of the delivery destination
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Package attributes
    package_weight = Column(Float, nullable=False, default=1.0)    # kg
    volume_m3 = Column(Float, nullable=False, default=0.1)         # m³

    # Time window for delivery (nullable = flexible)
    time_window_start = Column(DateTime, nullable=True)
    time_window_end = Column(DateTime, nullable=True)

    # Classification
    priority = Column(String(20), default="normal", nullable=False)  # low | normal | high | urgent
    # pending | assigned | in_transit | delivered | delayed
    status = Column(String(50), default="pending", nullable=False, index=True)

    notes = Column(String(500), nullable=True)

    # Vehicle assignment FK
    assigned_vehicle_id = Column(
        Integer,
        ForeignKey("vehicles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships
    vehicle = relationship("Vehicle", back_populates="deliveries", lazy="joined")

    __table_args__ = (
        Index("ix_deliveries_status_vehicle", "status", "assigned_vehicle_id"),
    )
