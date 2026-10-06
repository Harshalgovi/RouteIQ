"""
Travel-matrix construction for the optimisation engine.

Deliberately separate from `optimizer.py`: building the matrix is I/O-bound
(provider calls, caching, chunking) and the solver is pure CPU. Keeping them
apart means the matrix strategy can change — or move to a background worker —
without touching OR-Tools code, and it makes the matrix independently testable.

Real road data only. When a provider has no native table endpoint the builder
falls back to pairwise `calculate_route` calls, which are still real road
distances, but cost one provider request per pair — so the fallback is capped.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional, Sequence

from app.services.geocoding.base import Coordinates
from app.services.routing.base import MatrixResult, RouteStop
from app.services.routing.registry import get_routing_service

logger = logging.getLogger("routeiq.services.optimization.matrix")

#: Above this node count the pairwise fallback is refused outright, because it
#: would issue O(n²) provider requests and take minutes.
MAX_PAIRWISE_FALLBACK_NODES = 12


class MatrixBuildError(Exception):
    """The matrix could not be built (provider failure or unroutable locations)."""


def _haversine_meters(a: Coordinates, b: Coordinates) -> float:
    """Only used to prioritise the pairwise fallback; never reported as a cost."""
    from math import asin, cos, radians, sin, sqrt

    earth_radius_m = 6371000.0
    lat1, lat2 = radians(a.latitude), radians(b.latitude)
    dlat = lat2 - lat1
    dlon = radians(b.longitude - a.longitude)
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * earth_radius_m * asin(sqrt(h))


async def _pairwise_matrix(
    coordinates: Sequence[Coordinates],
    *,
    profile: Optional[str],
) -> MatrixResult:
    """
    Build the matrix from individual two-stop routes.

    Still real road data, but one provider request per ordered pair. Requests
    run with bounded concurrency so this stays far away from provider rate
    limits; results are memoised by the provider's own cache.
    """
    from app.services.routing.registry import get_routing_service as _get

    service = _get()
    size = len(coordinates)
    distances: list[list[float]] = [[0.0] * size for _ in range(size)]
    durations: list[list[float]] = [[0.0] * size for _ in range(size)]

    # Only one triangle is fetched; the grid is symmetric.
    pairs = [(i, j) for i in range(size) for j in range(i + 1, size)]

    async def fetch(pair: tuple[int, int]) -> tuple[tuple[int, int], float, float]:
        i, j = pair
        result = await service.calculate_route(
            [
                RouteStop(coordinates=coordinates[i], label=f"node-{i}", role="origin"),
                RouteStop(coordinates=coordinates[j], label=f"node-{j}", role="destination"),
            ],
            profile=profile,
        )
        return pair, result.distance_meters, result.duration_seconds

    semaphore = asyncio.Semaphore(4)

    async def guarded(pair: tuple[int, int]):
        async with semaphore:
            return await fetch(pair)

    outcomes = await asyncio.gather(*(guarded(pair) for pair in pairs), return_exceptions=True)

    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            raise outcome
        (i, j), distance_meters, duration_seconds = outcome
        distances[i][j] = distances[j][i] = distance_meters
        durations[i][j] = durations[j][i] = duration_seconds

    return MatrixResult(
        distances_meters=distances,
        durations_seconds=durations,
        provider=service.provider_id,
        profile=profile or getattr(service, "default_profile", "") or "driving",
        degraded=True,
    )


async def build_travel_matrix(
    coordinates: Sequence[Coordinates],
    *,
    profile: Optional[str] = None,
    provider_id: Optional[str] = None,
    allow_pairwise_fallback: bool = True,
) -> MatrixResult:
    """
    Build the origin→destination matrix for the supplied locations.

    Prefers the provider's native table endpoint. Falls back to pairwise real
    routes when the provider has none, provided the problem is small enough for
    that to be reasonable.
    """
    points = list(coordinates)
    if len(points) < 2:
        raise MatrixBuildError("A travel matrix needs at least two locations.")

    service = get_routing_service(provider_id)

    if getattr(service, "supports_matrix", False):
        return await service.calculate_matrix(points, profile=profile)

    if not allow_pairwise_fallback:
        raise MatrixBuildError(
            f"Routing provider '{service.provider_id}' cannot build a travel matrix."
        )

    if len(points) > MAX_PAIRWISE_FALLBACK_NODES:
        raise MatrixBuildError(
            f"Routing provider '{service.provider_id}' has no travel-matrix endpoint, and "
            f"this problem has {len(points)} locations — too many to resolve one route pair "
            f"at a time. Configure a provider that supports matrix requests."
        )

    logger.info(
        "[matrix] provider %s has no table endpoint; falling back to %d pairwise routes",
        service.provider_id,
        len(points) * (len(points) - 1) // 2,
    )
    return await _pairwise_matrix(points, profile=profile)


def nearest_neighbour_order(
    matrix: MatrixResult,
    origin_index: int,
    candidates: Sequence[int],
    *,
    end_index: Optional[int] = None,
) -> list[int]:
    """
    Deterministic greedy ordering used to build the comparison baseline.

    This is *not* an optimisation — it simply visits the closest remaining
    candidate each step, which is a defensible "unoptimised but sane" starting
    order. The engine never reports baseline numbers without labelling them.
    """
    remaining = list(candidates)
    order: list[int] = []
    current = origin_index

    while remaining:
        nxt = min(remaining, key=lambda idx: (matrix.distances_meters[current][idx], idx))
        order.append(nxt)
        remaining.remove(nxt)
        current = nxt

    if end_index is not None:
        return order
    return order


def total_path_cost(
    matrix: MatrixResult,
    sequence: Sequence[int],
    *,
    start_index: Optional[int] = None,
    end_index: Optional[int] = None,
) -> tuple[float, float]:
    """
    (distance_meters, duration_seconds) along one ordered path over the matrix.

    Used to verify that a solved route's reported totals are consistent with the
    same real matrix the solver was given.
    """
    nodes: list[int] = []
    if start_index is not None:
        nodes.append(start_index)
    nodes.extend(sequence)
    if end_index is not None:
        nodes.append(end_index)

    if len(nodes) < 2:
        return 0.0, 0.0

    distance = 0.0
    duration = 0.0
    for i in range(len(nodes) - 1):
        distance += matrix.distances_meters[nodes[i]][nodes[i + 1]]
        duration += matrix.durations_seconds[nodes[i]][nodes[i + 1]]
    return round(distance, 1), round(duration, 1)


__all__ = [
    "MAX_PAIRWISE_FALLBACK_NODES",
    "MatrixBuildError",
    "build_travel_matrix",
    "nearest_neighbour_order",
    "total_path_cost",
]
