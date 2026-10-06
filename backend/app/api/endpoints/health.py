"""
Health check API endpoint.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.config import settings
from app.core.database import get_db
from app.schemas.health import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, summary="System Health Check")
def get_health(db: Session = Depends(get_db)):
    """
    Check API and database health status.
    Returns general system metadata and verifies database connectivity.
    """
    db_status = "connected"
    db_details = None

    try:
        # Simple connectivity query
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = "error"
        db_details = {"error": str(e)}

    return HealthResponse(
        status="ok" if db_status == "connected" else "degraded",
        app=settings.APP_NAME,
        version=settings.VERSION,
        environment=settings.APP_ENV,
        database=db_status,
        details=db_details,
    )
