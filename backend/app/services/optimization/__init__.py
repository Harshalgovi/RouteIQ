"""
RouteIQ optimisation engine.

Layout:
    models.py      — solver-facing dataclasses (no OR-Tools import)
    constraints.py — eligibility, pre-flight validation, infeasibility diagnosis
    matrix.py      — real travel-matrix construction (I/O bound)
    optimizer.py   — the OR-Tools model (CPU bound)
    service.py     — orchestration: database -> matrix -> solve -> API response

Attributes are resolved lazily (PEP 562) so that importing a leaf module such as
``app.services.optimization.models`` — which the API schemas do — does not drag
in ``service.py`` and its dependency on the schemas.
"""

from typing import Any

_EXPORTS: dict[str, tuple[str, str]] = {
    # constraints
    "OptimizationInputError": ("constraints", "OptimizationInputError"),
    "build_default_objective": ("constraints", "build_default_objective"),
    "check_capacity_feasibility": ("constraints", "check_capacity_feasibility"),
    "check_time_window_feasibility": ("constraints", "check_time_window_feasibility"),
    "delivery_is_routable": ("constraints", "delivery_is_routable"),
    "report_eligibility": ("constraints", "report_eligibility"),
    "vehicle_is_available": ("constraints", "vehicle_is_available"),
    # matrix
    "MatrixBuildError": ("matrix", "MatrixBuildError"),
    "build_travel_matrix": ("matrix", "build_travel_matrix"),
    # models
    "Comparison": ("models", "Comparison"),
    "ConstraintViolation": ("models", "ConstraintViolation"),
    "DeliveryNode": ("models", "DeliveryNode"),
    "InfeasibilityReason": ("models", "InfeasibilityReason"),
    "ObjectiveWeights": ("models", "ObjectiveWeights"),
    "OptimizationProblem": ("models", "OptimizationProblem"),
    "OptimizationResult": ("models", "OptimizationResult"),
    "OptimizationStatus": ("models", "OptimizationStatus"),
    "ScheduledStop": ("models", "ScheduledStop"),
    "SolverDiagnostics": ("models", "SolverDiagnostics"),
    "TimeWindow": ("models", "TimeWindow"),
    "UnassignedDelivery": ("models", "UnassignedDelivery"),
    "VehicleNode": ("models", "VehicleNode"),
    "VehicleRoute": ("models", "VehicleRoute"),
    # optimizer
    "build_baseline": ("optimizer", "build_baseline"),
    "solve": ("optimizer", "solve"),
    "solve_async": ("optimizer", "solve_async"),
    # service
    "OptimizationService": ("service", "OptimizationService"),
    "optimization_service": ("service", "optimization_service"),
}


def __getattr__(name: str) -> Any:
    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    from importlib import import_module

    module = import_module(f"{__name__}.{target[0]}")
    value = getattr(module, target[1])
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(_EXPORTS))


__all__ = sorted(_EXPORTS)
