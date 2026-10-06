"""
Base SQLAlchemy models and mixins.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime
from app.core.database import Base


class TimestampMixin:
    """Mixin for models requiring created_at and updated_at timestamps."""
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
