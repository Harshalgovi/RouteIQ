"""
SQLAlchemy model for Driver entities in RouteIQ.
"""

from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class Driver(Base, TimestampMixin):
    """Fleet driver profile. Does not store passwords or sensitive personal data."""

    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(30), nullable=True)
    # active | off_duty | suspended
    status = Column(String(30), default="active", nullable=False, index=True)

    # Relationships
    vehicles = relationship("Vehicle", back_populates="driver", lazy="select")
