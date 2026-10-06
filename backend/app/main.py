"""
Main FastAPI application entry point for RouteIQ.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import engine, Base

# Import all models so SQLAlchemy can discover them for create_all / Alembic
import app.models  # noqa: F401

from app.api.router import api_router

logger = logging.getLogger("routeiq.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creating the schema is a development convenience; production uses Alembic
    # migrations. It must never abort startup: on hosts with a read-only
    # filesystem (or an unreachable/absent DATABASE_URL) the default SQLite URL
    # cannot even open its file, and an unhandled error here would take down
    # every route — including /health, which is how the frontend learns the
    # backend is up. Log and continue instead; individual endpoints and the
    # health check then report the real state honestly.
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:  # noqa: BLE001 - startup must not crash
        logger.warning(
            "Could not create database schema at startup (%s). "
            "The API will continue to serve; set DATABASE_URL to a reachable "
            "PostgreSQL instance and run migrations.",
            exc,
        )
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# CORS setup
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# Global error handler — never expose stack traces to clients
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again later."},
    )


# Include central API router with configured prefix (/api/v1)
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def root():
    return {
        "message": "Welcome to RouteIQ — Intelligent Delivery Route Optimization Platform API",
        "docs": f"{settings.API_V1_STR}/docs",
        "health": f"{settings.API_V1_STR}/health",
    }
