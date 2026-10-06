"""
Tests for the routing service abstraction and its OSRM implementation.
"""

import pytest

from app.services.geocoding.base import Coordinates
from app.services.providers.errors import (
    InvalidCoordinatesError,
    InvalidLocationError,
    ProviderBadResponseError,
    ProviderNotFoundError,
)
from app.services.routing.base import RouteStop, RoutingService
from app.services.routing.osrm import OsrmRoutingService

API_BASE = "/api/v1"


def make_service(**kwargs) -> OsrmRoutingService:
    defaults = dict(base_url="https://osrm.test", min_interval_seconds=0.0, cache_ttl_seconds=60)
    defaults.update(kwargs)
    return OsrmRoutingService(**defaults)


def make_stops(count: int = 2):
    coords = [
        Coordinates(41.8802, -87.6367),
        Coordinates(41.8917, -87.6243),
        Coordinates(41.8893, -87.6474),
        Coordinates(41.8984, -87.6312),
    ]
    roles = ["origin"] + ["stop"] * (count - 2) + ["destination"]
    return [
        RouteStop(coordinates=coords[i], label=f"point-{i}", role=roles[i])
        for i in range(count)
    ]


OSRM_OK = {
    "code": "Ok",
    "waypoints": [
        {"location": [-87.6367, 41.8802], "name": "Wacker Dr"},
        {"location": [-87.6243, 41.8917], "name": "Michigan Ave"},
    ],
    "routes": [
        {
            "distance": 3245.6,
            "duration": 421.4,
            "geometry": {
                "type": "LineString",
                "coordinates": [[-87.6367, 41.8802], [-87.63, 41.885], [-87.6243, 41.8917]],
            },
            "bbox": [-87.6367, 41.8802, -87.6243, 41.8917],
            "legs": [
                {"distance": 3245.6, "duration": 421.4},
            ],
        }
    ],
}


def patch_payload(service, payload, *, error=None):
    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        if error is not None:
            raise error
        _get_json.last = (url, params, accepted_statuses)
        return payload

    service._client.get_json = _get_json  # type: ignore[assignment]
    return _get_json


# ── Travel matrix ─────────────────────────────────────────────────────────────
#
# The matrix underpins every optimization result, so it gets the most scrutiny
# here: the grid must be built from real provider values in both directions,
# never mirrored, and the request shape must be one the provider actually
# answers.


def make_matrix_points(count: int):
    """Distinct points around Chicago, enough to expose an asymmetric matrix."""
    coords = [
        Coordinates(41.8802, -87.6367),
        Coordinates(41.8917, -87.6243),
        Coordinates(41.8893, -87.6474),
        Coordinates(41.8984, -87.6312),
    ]
    return [coords[i % len(coords)] for i in range(count)]


def patch_matrix(service, grid, calls=None):
    """Serve `grid` (an n x n list of durations) for any /table request.

    The fake echoes back only the rows and columns the request asked for, which
    is what OSRM does, so a caller that requested a subset is exercised the same
    way as one that requested everything.
    """
    distances = [[value * 10 for value in row] for row in grid]

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        if calls is not None:
            calls.append((url, dict(params or {})))
        sources = [int(v) for v in str(params["sources"]).split(";")]
        destinations = [int(v) for v in str(params["destinations"]).split(";")]
        return {
            "code": "Ok",
            "distances": [[distances[i][j] for j in destinations] for i in sources],
            "durations": [[grid[i][j] for j in destinations] for i in sources],
        }

    service._client.get_json = _get_json  # type: ignore[assignment]
    return _get_json


# Deliberately asymmetric: every off-diagonal value encodes its own row and
# column, so a mirrored or transposed grid cannot coincidentally match.
ASYMMETRIC_GRID = [
    [0.0, 111.0, 222.0, 333.0],
    [444.0, 0.0, 555.0, 666.0],
    [777.0, 888.0, 0.0, 999.0],
    [121.0, 232.0, 343.0, 0.0],
]


@pytest.mark.asyncio
async def test_matrix_preserves_asymmetry_in_both_directions():
    """One-way roads make A→B differ from B→A; both must survive verbatim."""
    service = make_service()
    patch_matrix(service, ASYMMETRIC_GRID)

    result = await service.calculate_matrix(make_matrix_points(4))

    assert result.distances_meters == [[v * 10 for v in row] for row in ASYMMETRIC_GRID]
    assert result.durations_seconds == ASYMMETRIC_GRID
    assert result.degraded is False


@pytest.mark.asyncio
async def test_matrix_off_diagonal_values_are_not_mirrored():
    """Guards the specific regression: the upper triangle must not be a copy."""
    service = make_service()
    patch_matrix(service, ASYMMETRIC_GRID)

    result = await service.calculate_matrix(make_matrix_points(4))

    for i in range(4):
        for j in range(4):
            if i == j:
                continue
            assert result.durations_seconds[i][j] != result.durations_seconds[j][i], (
                f"durations[{i}][{j}] mirrors the reverse leg; the matrix was symmetrised"
            )
            assert result.distances_meters[i][j] == ASYMMETRIC_GRID[i][j] * 10


@pytest.mark.asyncio
async def test_matrix_requests_all_indices_in_both_directions():
    """Every origin and destination index must be requested, not just the upper half."""
    service = make_service()
    calls: list = []
    patch_matrix(service, ASYMMETRIC_GRID, calls)

    await service.calculate_matrix(make_matrix_points(4))

    assert len(calls) == 1, "a 4-point matrix fits in one request"
    params = calls[0][1]
    assert params["sources"] == "0;1;2;3"
    assert params["destinations"] == "0;1;2;3"
    assert params["annotations"] == "duration,distance"
    assert "/table/v1/driving/" in calls[0][0]


@pytest.mark.asyncio
async def test_matrix_diagonal_is_zero_self_cost():
    service = make_service()
    patch_matrix(service, ASYMMETRIC_GRID)

    result = await service.calculate_matrix(make_matrix_points(4))

    for i in range(4):
        assert result.durations_seconds[i][i] == 0.0
        assert result.distances_meters[i][i] == 0.0


@pytest.mark.asyncio
async def test_matrix_pair_lookup_uses_real_grid_values():
    """MatrixResult.pair must index the grid as given, not transpose it."""
    from app.services.routing.base import MatrixResult

    service = make_service()
    patch_matrix(service, ASYMMETRIC_GRID)
    result = await service.calculate_matrix(make_matrix_points(4))

    assert result.pair(0, 3) == (ASYMMETRIC_GRID[0][3] * 10, ASYMMETRIC_GRID[0][3])
    assert result.pair(3, 0) == (ASYMMETRIC_GRID[3][0] * 10, ASYMMETRIC_GRID[3][0])


@pytest.mark.asyncio
async def test_matrix_rejects_a_single_point():
    service = make_service()
    patch_matrix(service, [[0.0]])

    with pytest.raises(InvalidLocationError):
        await service.calculate_matrix(make_matrix_points(1))


@pytest.mark.asyncio
async def test_matrix_maps_provider_failure_to_not_found():
    service = make_service()

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        return {"code": "NoRoute"}

    service._client.get_json = _get_json  # type: ignore[assignment]

    with pytest.raises(ProviderNotFoundError):
        await service.calculate_matrix(make_matrix_points(3))


@pytest.mark.asyncio
async def test_matrix_rejects_a_grid_of_the_wrong_shape():
    """A truncated grid must fail loudly rather than being padded with zeros."""
    service = make_service()

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        return {
            "code": "Ok",
            "distances": [[100.0, 200.0]],  # one row, two columns, for three points
            "durations": [[10.0, 20.0]],
        }

    service._client.get_json = _get_json  # type: ignore[assignment]

    with pytest.raises(ProviderBadResponseError):
        await service.calculate_matrix(make_matrix_points(3))


@pytest.mark.asyncio
async def test_chunked_matrix_requests_cover_every_cell_exactly_once():
    """Chunking must tile the grid: each (i, j) pair assembled from one response."""
    service = make_service()
    calls: list = []

    # A small chunk size forces several requests for the same four points.
    service.MATRIX_CHUNK_SIZE = 2
    patch_matrix(service, ASYMMETRIC_GRID, calls)

    result = await service.calculate_matrix(make_matrix_points(4))

    assert result.durations_seconds == ASYMMETRIC_GRID
    assert len(calls) == 4, "two source chunks x two destination chunks"

    covered = set()
    for _url, params in calls:
        sources = [int(v) for v in str(params["sources"]).split(";")]
        destinations = [int(v) for v in str(params["destinations"]).split(";")]
        for i in sources:
            for j in destinations:
                covered.add((i, j))
    assert covered == {(i, j) for i in range(4) for j in range(4)}


# ── Request shape ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_route_request_uses_lon_lat_ordering():
    service = make_service()
    spy = patch_payload(service, OSRM_OK)

    await service.calculate_route(make_stops(2), profile="driving")

    url = spy.last[0]
    # OSRM requires longitude,latitude
    assert "/route/v1/driving/-87.636700,41.880200;-87.624300,41.891700" in url


@pytest.mark.asyncio
async def test_route_request_includes_waypoints_and_geometry_params():
    service = make_service()
    spy = patch_payload(service, OSRM_OK)
    await service.calculate_route(make_stops(3))
    params = spy.last[1]
    assert params["overview"] == "full"
    assert params["geometries"] == "geojson"
    # OSRM reports "no route" with HTTP 400 + a structured body.
    assert 400 in spy.last[2]


@pytest.mark.asyncio
async def test_route_requires_two_stops():
    service = make_service()
    with pytest.raises(InvalidLocationError):
        await service.calculate_route(make_stops(1))


@pytest.mark.asyncio
async def test_route_rejects_unsupported_profile():
    service = make_service()
    with pytest.raises(InvalidLocationError):
        await service.calculate_route(make_stops(2), profile="teleport")


@pytest.mark.asyncio
async def test_route_rejects_out_of_range_coordinates():
    service = make_service()
    bad = [
        RouteStop(coordinates=Coordinates(91.0, 0.0), role="origin"),
        RouteStop(coordinates=Coordinates(41.0, -87.0), role="destination"),
    ]
    with pytest.raises(InvalidCoordinatesError):
        await service.calculate_route(bad)


# ── Response parsing ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_route_parses_distance_duration_and_geometry():
    service = make_service()
    patch_payload(service, OSRM_OK)

    result = await service.calculate_route(make_stops(2))

    assert result.distance_meters == pytest.approx(3245.6)
    assert result.duration_seconds == pytest.approx(421.4)
    assert result.distance_km == pytest.approx(3.246, abs=1e-3)
    assert result.duration_minutes == pytest.approx(7.0, abs=0.1)
    assert len(result.geometry.coordinates) == 3
    assert result.waypoints[0].role == "origin"
    assert result.waypoints[1].role == "destination"
    assert result.bounds is not None
    assert result.bounds.min_latitude == pytest.approx(41.8802)


@pytest.mark.asyncio
async def test_route_geometry_is_geojson_lon_lat():
    service = make_service()
    patch_payload(service, OSRM_OK)
    result = await service.calculate_route(make_stops(2))
    point = result.geometry.as_geojson()["coordinates"][0]
    assert point[0] == pytest.approx(-87.6367)
    assert point[1] == pytest.approx(41.8802)


@pytest.mark.asyncio
async def test_route_legs_are_parsed():
    service = make_service()
    payload = {
        "code": "Ok",
        "waypoints": [
            {"location": [-87.6367, 41.8802], "name": "a"},
            {"location": [-87.64, 41.885], "name": "b"},
            {"location": [-87.6243, 41.8917], "name": "c"},
        ],
        "routes": [
            {
                "distance": 3245.6,
                "duration": 421.4,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-87.6367, 41.8802], [-87.6243, 41.8917]],
                },
                "legs": [
                    {"distance": 2000.0, "duration": 300.0},
                    {"distance": 1245.6, "duration": 121.4},
                ],
            }
        ],
    }
    patch_payload(service, payload)
    result = await service.calculate_route(make_stops(3))
    assert len(result.legs) == 2
    assert result.legs[0].from_label == "point-0"
    assert result.legs[0].to_label == "point-1"
    assert result.legs[-1].to_label == "point-2"
    assert result.legs[1].distance_meters == pytest.approx(1245.6)


@pytest.mark.asyncio
async def test_no_route_code_maps_to_not_found():
    service = make_service()
    patch_payload(service, {"code": "NoRoute", "routes": []})
    with pytest.raises(ProviderNotFoundError):
        await service.calculate_route(make_stops(2))


@pytest.mark.asyncio
async def test_missing_geometry_maps_to_bad_response():
    service = make_service()
    payload = {
        "code": "Ok",
        "routes": [{"distance": 100.0, "duration": 60.0, "geometry": {"coordinates": []}}],
    }
    patch_payload(service, payload)
    with pytest.raises(ProviderBadResponseError):
        await service.calculate_route(make_stops(2))


@pytest.mark.asyncio
async def test_unexpected_payload_maps_to_bad_response():
    service = make_service()
    patch_payload(service, ["not", "a", "dict"])
    with pytest.raises(ProviderBadResponseError):
        await service.calculate_route(make_stops(2))


# ── Caching ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_identical_routes_are_cached():
    service = make_service(cache_ttl_seconds=120)
    calls = {"count": 0}

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        calls["count"] += 1
        return OSRM_OK

    service._client.get_json = _get_json  # type: ignore[assignment]

    await service.calculate_route(make_stops(2))
    await service.calculate_route(make_stops(2))
    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_different_routes_are_not_shared_in_cache():
    service = make_service(cache_ttl_seconds=120)
    calls = {"count": 0}

    async def _get_json(url, params=None, headers=None, accepted_statuses=None):
        calls["count"] += 1
        return OSRM_OK

    service._client.get_json = _get_json  # type: ignore[assignment]

    await service.calculate_route(make_stops(2))
    await service.calculate_route(make_stops(3))
    assert calls["count"] == 2


# ── Registry ──────────────────────────────────────────────────────────────────


def test_registry_returns_configured_service():
    from app.services.routing.registry import get_routing_service

    service = get_routing_service()
    assert isinstance(service, RoutingService)
    assert service.provider_id == "osrm"


def test_registry_rejects_unknown_provider():
    from app.services.routing.registry import get_routing_service
    from app.services.providers.errors import ProviderConfigurationError

    with pytest.raises(ProviderConfigurationError):
        get_routing_service("teleport-routing")
