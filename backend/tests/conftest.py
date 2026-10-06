"""
Pytest fixtures configuration — shared across all tests.
Uses an in-memory SQLite test database to avoid polluting the real database.
"""

import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Ensure backend root is in sys.path
backend_root = Path(__file__).parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

# Use in-memory SQLite for tests — no PostgreSQL required
TEST_DATABASE_URL = "sqlite:///./test_routeiq.db"

import app.models  # noqa: F401 — register all models (imported BEFORE `app` below,
# otherwise this package import shadows the FastAPI instance named `app`)
from app.core.database import Base, get_db
from app.main import app

test_engine = create_engine(
    TEST_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def db():
    """Per-test database session with clean state."""
    Base.metadata.create_all(bind=test_engine)
    session = TestSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def client(db):
    """Test client with DB override applied."""
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=test_engine)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


# ─────────────────────────────────────────────────────────────────────────────
# Map provider fixtures (geocoding / routing / basemap)
#
# All provider tests run against deterministic fakes so the suite never touches
# the network. Live smoke tests live in test_providers_live.py and only run when
# ROUTEIQ_LIVE_PROVIDER_TESTS=1.
# ─────────────────────────────────────────────────────────────────────────────

from tests.provider_fakes import (  # noqa: E402
    FakeGeocodingService,
    FakeRoutingService,
)


@pytest.fixture
def fake_geocoder() -> FakeGeocodingService:
    return FakeGeocodingService()


@pytest.fixture
def fake_router() -> FakeRoutingService:
    return FakeRoutingService()


@pytest.fixture
def use_fake_providers(monkeypatch, fake_geocoder, fake_router):
    """Point the geocoding/routing registries at the deterministic fakes."""
    import importlib

    geocoding_endpoints = importlib.import_module("app.api.endpoints.geocoding")
    route_preview = importlib.import_module("app.services.route_preview_service")
    geocoding_registry = importlib.import_module("app.services.geocoding.registry")
    routing_registry = importlib.import_module("app.services.routing.registry")
    optimization_matrix = importlib.import_module("app.services.optimization.matrix")
    optimization_service = importlib.import_module("app.services.optimization.service")

    for module in (geocoding_registry, route_preview, geocoding_endpoints):
        monkeypatch.setattr(
            module, "get_geocoding_service", lambda *a, **k: fake_geocoder
        )
    for module in (
        routing_registry,
        route_preview,
        optimization_matrix,
        optimization_service,
    ):
        monkeypatch.setattr(module, "get_routing_service", lambda *a, **k: fake_router)

    # The optimiser resolves un-geocoded addresses through this helper.
    async def _fake_resolver(address):  # noqa: ARG001
        return await fake_geocoder.geocode(address)

    monkeypatch.setattr(optimization_service, "resolve_address", _fake_resolver)

    return fake_geocoder, fake_router


@pytest.fixture
def patch_delivery_resolver(monkeypatch):
    """
    Patch the geocoding resolver used by the delivery service.

    Returns a setter so a test can control the resolved value (or the failure).
    """

    def _set(result=None, error=None):
        # NOTE: `app.services` re-exports the `delivery_service` *instance* under
        # the module name, so the module object must be fetched explicitly.
        import importlib

        module = importlib.import_module("app.services.delivery_service")

        async def _resolver(address):  # noqa: ARG001
            if error is not None:
                raise error
            return result

        monkeypatch.setattr(module, "resolve_address", _resolver)

    return _set

