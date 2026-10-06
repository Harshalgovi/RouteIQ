"""
Routing service abstraction.

Public surface:
  get_routing_service()      -> the configured RoutingService singleton
  get_routing_service_info() -> provider metadata for the frontend
"""

from app.services.routing.base import (
    RouteBounds,
    RouteGeometry,
    RouteLeg,
    RouteResult,
    RouteStop,
    RouteWaypoint,
    RoutingService,
)
from app.services.routing.registry import (
    SUPPORTED_PROVIDERS,
    get_routing_service,
    get_routing_service_info,
)

__all__ = [
    "RouteBounds",
    "RouteGeometry",
    "RouteLeg",
    "RouteResult",
    "RouteStop",
    "RouteWaypoint",
    "RoutingService",
    "SUPPORTED_PROVIDERS",
    "get_routing_service",
    "get_routing_service_info",
]
