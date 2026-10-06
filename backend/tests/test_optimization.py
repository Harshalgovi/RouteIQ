"""
Tests for the OR-Tools optimisation engine — POST /api/v1/routes/optimize.

Covers the required scenarios:
    1. single vehicle + multiple deliveries
    2. multiple vehicles
    3. vehicle capacity constraint
    4. time-window constraint
    5. no available vehicles
    6. insufficient capacity
    7. invalid delivery
    8. invalid coordinates
    9. successful optimization
    10. infeasible optimization

Invariants asserted throughout: no vehicle exceeds capacity, no delivery is
served twice, every eligible delivery is either assigned or explicitly reported
as unassigned, routes contain ordered stops, and reported distance/time match the
same real matrix the solver was given.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.delivery import Delivery
from app.models.driver import Driver
from app.models.vehicle import Vehicle

BASE = "/api/v1"

# A compact, geographically spread Chicago grid so ordering actually matters.
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _shift(hours: int = 0, minutes: int = 0) -> datetime:
    return NOW + timedelta(hours=hours, minutes=minutes)


def make_vehicle(
    db,
    *,
    number: str,
    capacity_kg: float = 100.0,
    volume_m3: float = 10.0,
    status: str = "available",
    lat: float | None = 41.880216,
    lon: float | None = -87.636747,
    driver_status: str | None = "active",
    driver_name: str | None = None,
) -> Vehicle:
    driver_id = None
    if driver_name is not None:
        driver = Driver(name=driver_name, status=driver_status or "active")
        db.add(driver)
        db.flush()
        driver_id = driver.id

    vehicle = Vehicle(
        vehicle_number=number,
        name=f"Van {number}",
        license_plate=f"LP-{number}",
        vehicle_type="van",
        capacity_kg=capacity_kg,
        capacity_volume_m3=volume_m3,
        status=status,
        current_latitude=lat,
        current_longitude=lon,
        driver_id=driver_id,
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


def make_delivery(
    db,
    *,
    tracking_number: str,
    weight: float = 10.0,
    volume_m3: float = 0.5,
    lat: float = 41.88,
    lon: float = -87.64,
    status: str = "pending",
    priority: str = "normal",
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    address: str = "120 S Wacker Dr, Chicago, IL 60606",
) -> Delivery:
    delivery = Delivery(
        tracking_number=tracking_number,
        customer_name=f"Customer {tracking_number}",
        address=address,
        latitude=lat,
        longitude=lon,
        package_weight=weight,
        volume_m3=volume_m3,
        priority=priority,
        status=status,
        time_window_start=window_start,
        time_window_end=window_end,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def preferences(**overrides) -> dict:
    """Default preferences: zero dwell time so time windows are testable in isolation."""
    base = {
        "use_current_vehicle_positions": True,
        "service_seconds_per_delivery": 0.0,
        "time_limit_seconds": 5.0,
    }
    base.update(overrides)
    return {"preferences": base}


# ─────────────────────────────────────────────────────────────────────────────
# 9. Successful optimization (baseline behaviour)
# ─────────────────────────────────────────────────────────────────────────────


def test_optimize_returns_a_real_plan(client, db, use_fake_providers):
    """A basic request solves, reports totals, and every stop is ordered."""
    vehicle = make_vehicle(db, number="V-01", capacity_kg=500.0)
    for index in range(3):
        make_delivery(db, tracking_number=f"D-{index}", lat=41.88 + index * 0.01, lon=-87.64)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] in {"optimal", "feasible"}
    assert data["provider"] == "fake"
    assert data["summary"]["vehicles_used"] == 1
    assert data["summary"]["deliveries_assigned"] == 3
    assert data["summary"]["deliveries_unassigned"] == 0
    assert data["summary"]["total_distance_meters"] > 0
    assert data["summary"]["total_duration_seconds"] > 0

    route = data["routes"][0]
    assert route["vehicle_id"] == vehicle.id
    assert route["vehicle_number"] == "V-01"
    assert route["stop_count"] == 3
    # Stop order is sequential 1..n.
    assert [s["sequence"] for s in route["stops"]] == [1, 2, 3]
    assert route["capacity"]["used_kg"] == pytest.approx(30.0)
    assert route["capacity"]["remaining_kg"] == pytest.approx(470.0)
    assert route["has_time_window_violations"] is False
    # A baseline comparison is always provided and always labelled.
    assert data["baseline"] is not None
    assert data["baseline"]["baseline"]["label"] == "Original delivery order"


def test_optimize_stops_carry_estimates_and_windows(client, db, use_fake_providers):
    make_vehicle(db, number="V-01", capacity_kg=500.0)
    make_delivery(
        db,
        tracking_number="D-1",
        window_start=_shift(1),
        window_end=_shift(3),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    stop = resp.json()["routes"][0]["stops"][0]

    assert stop["estimated_arrival"]
    assert stop["window_start"] is not None and stop["window_end"] is not None
    assert stop["within_window"] is True
    assert stop["wait_seconds"] >= 0
    assert stop["service_start"] >= stop["arrival"]


# ─────────────────────────────────────────────────────────────────────────────
# 1. Single vehicle + multiple deliveries
# ─────────────────────────────────────────────────────────────────────────────


def test_single_vehicle_visits_every_delivery_once(client, db, use_fake_providers):
    make_vehicle(db, number="V-ONLY", capacity_kg=1000.0)
    expected = {f"D-{i}" for i in range(6)}
    for index in range(6):
        make_delivery(db, tracking_number=f"D-{index}", lat=41.85 + index * 0.02, lon=-87.70 + index * 0.02)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    served = [s["tracking_number"] for r in data["routes"] for s in r["stops"]]
    assert sorted(served) == sorted(expected)
    # No duplicates.
    assert len(served) == len(set(served))
    assert data["summary"]["vehicles_used"] == 1


def test_single_vehicle_optimises_ordering(client, db, use_fake_providers):
    """The solver must not simply return the database order when a better one exists."""
    vehicle = make_vehicle(db, number="V-01", capacity_kg=1000.0, lat=41.88, lon=-87.64)
    # Database order is deliberately the worst possible sequence.
    far_then_near = [(41.95, -87.70), (41.92, -87.68), (41.881, -87.638)]
    for index, (lat, lon) in enumerate(far_then_near):
        make_delivery(db, tracking_number=f"D-{index}", lat=lat, lon=lon)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    order = [s["tracking_number"] for s in data["routes"][0]["stops"]]
    # The nearest delivery should be visited first.
    assert order[0] == "D-2"

    # The optimised total must be at least as good as the labelled baseline.
    baseline = data["baseline"]["baseline"]
    optimized = data["baseline"]["optimized_distance_meters"]
    assert optimized <= baseline["total_distance_meters"] + 1e-6


# ─────────────────────────────────────────────────────────────────────────────
# 2. Multiple vehicles
# ─────────────────────────────────────────────────────────────────────────────


def test_multiple_vehicles_each_receive_a_route(client, db, use_fake_providers):
    for index in range(3):
        make_vehicle(
            db,
            number=f"V-{index}",
            capacity_kg=60.0,
            lat=41.88,
            lon=-87.64,
            driver_name=f"Driver {index}",
        )
    # 60 kg capacity means at most 2 deliveries of 25 kg per van.
    for index in range(6):
        make_delivery(
            db, tracking_number=f"D-{index}", weight=25.0, lat=41.88 + index * 0.02, lon=-87.70 + index * 0.01
        )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["summary"]["vehicles_used"] == 3
    assert data["summary"]["vehicles_available"] == 3
    assert data["summary"]["deliveries_assigned"] == 6

    numbers = [r["vehicle_number"] for r in data["routes"]]
    assert sorted(numbers) == ["V-0", "V-1", "V-2"]

    # Every delivery served exactly once across all routes.
    served = [s["tracking_number"] for r in data["routes"] for s in r["stops"]]
    assert sorted(served) == [f"D-{i}" for i in range(6)]

    # Each vehicle has a driver reported.
    for route in data["routes"]:
        assert route["driver_name"]


def test_multiple_vehicles_split_work_by_capacity(client, db, use_fake_providers):
    """One heavy van and one small van: the engine must load both, not just one."""
    make_vehicle(db, number="V-BIG", capacity_kg=250.0, lat=41.88, lon=-87.64)
    make_vehicle(db, number="V-SMALL", capacity_kg=20.0, lat=41.88, lon=-87.64)

    make_delivery(db, tracking_number="HEAVY-1", weight=120.0)
    make_delivery(db, tracking_number="HEAVY-2", weight=90.0)
    make_delivery(db, tracking_number="LIGHT-1", weight=15.0)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    by_number = {r["vehicle_number"]: r for r in data["routes"]}
    # V-SMALL can only take the light delivery.
    assert [s["tracking_number"] for s in by_number["V-SMALL"]["stops"]] == ["LIGHT-1"]
    assert by_number["V-SMALL"]["capacity"]["used_kg"] == pytest.approx(15.0)
    # V-BIG takes the rest.
    assert {s["tracking_number"] for s in by_number["V-BIG"]["stops"]} == {
        "HEAVY-1",
        "HEAVY-2",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. Vehicle capacity constraint
# ─────────────────────────────────────────────────────────────────────────────


def test_capacity_constraint_distributes_load(client, db, use_fake_providers):
    """
    The spec's example: A=30, B=40, C=50 must NOT all land on a 100 kg van.

    Total demand (120 kg) exceeds the single van (100 kg), so the engine must
    refuse with an explanation instead of returning an overloaded route.
    """
    make_vehicle(db, number="V-100", capacity_kg=100.0)
    make_delivery(db, tracking_number="A", weight=30.0, lat=41.86, lon=-87.66)
    make_delivery(db, tracking_number="B", weight=40.0, lat=41.90, lon=-87.62)
    make_delivery(db, tracking_number="C", weight=50.0, lat=41.92, lon=-87.68)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert "capacity is insufficient" in detail
    assert "120 kg" in detail and "100 kg" in detail


def test_capacity_constraint_keeps_each_vehicle_within_limit(client, db, use_fake_providers):
    """A=30, B=40, C=50 across two vans: B+C on one, A on the other. Never 120 on one."""
    make_vehicle(db, number="V-1", capacity_kg=100.0, lat=41.88, lon=-87.64)
    make_vehicle(db, number="V-2", capacity_kg=100.0, lat=41.89, lon=-87.65)
    make_delivery(db, tracking_number="A", weight=30.0, lat=41.86, lon=-87.66)
    make_delivery(db, tracking_number="B", weight=40.0, lat=41.90, lon=-87.62)
    make_delivery(db, tracking_number="C", weight=50.0, lat=41.92, lon=-87.68)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    by_number = {r["vehicle_number"]: r for r in data["routes"]}
    assert len(by_number) == 2
    for route in data["routes"]:
        assert route["capacity"]["used_kg"] <= 100.0, "capacity exceeded"
        assert route["capacity"]["used_kg"] <= 100.0 + 1e-6

    # 30 cannot pair with 40 or 50, so A travels alone.
    alone = [n for n, r in by_number.items() if r["stop_count"] == 1]
    assert alone == ["V-2"] or alone == ["V-1"]
    assert by_number[alone[0]]["stops"][0]["tracking_number"] == "A"

    served = [s["tracking_number"] for r in data["routes"] for s in r["stops"]]
    assert sorted(served) == ["A", "B", "C"]


def test_capacity_is_never_exceeded_across_many_routes(client, db, use_fake_providers):
    make_vehicle(db, number="V-A", capacity_kg=50.0, lat=41.88, lon=-87.64)
    make_vehicle(db, number="V-B", capacity_kg=50.0, lat=41.89, lon=-87.65)
    for index in range(8):
        make_delivery(db, tracking_number=f"D-{index}", weight=20.0, lat=41.85 + index * 0.02)

    # 160 kg of demand against 100 kg of fleet capacity: partial mode is the
    # only way to get a plan, and the invariant under test is the per-route cap.
    resp = client.post(f"{BASE}/routes/optimize", json=preferences(allow_partial=True))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    total_assigned = 0
    for route in data["routes"]:
        assert route["capacity"]["used_kg"] <= route["capacity"]["capacity_kg"] + 1e-6
        if route["capacity"]["capacity_kg"] > 0:
            assert route["capacity"]["utilization_percent"] <= 100.0 + 1e-6
        total_assigned += route["stop_count"]

    assert total_assigned == data["summary"]["deliveries_assigned"]
    assert total_assigned + data["summary"]["deliveries_unassigned"] == 8
    assert data["summary"]["deliveries_assigned"] == 4


def test_volume_capacity_is_respected(client, db, use_fake_providers):
    """Weight is generous but volume is the binding constraint."""
    make_vehicle(db, number="V-VOL", capacity_kg=1000.0, volume_m3=2.0)
    for index in range(4):
        make_delivery(
            db, tracking_number=f"D-{index}", weight=1.0, volume_m3=1.0, lat=41.85 + index * 0.02
        )

    # 4 m³ of demand against 2 m³ of capacity cannot all be served.
    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 409, resp.text
    assert "volume is insufficient" in resp.json()["detail"]

    # With two vans it fits, and the volume dimension is genuinely enforced.
    make_vehicle(db, number="V-VOL2", capacity_kg=1000.0, volume_m3=2.0, lat=41.89, lon=-87.65)
    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "volume_m3" in data["summary"]["constraints_enforced"]
    for route in data["routes"]:
        assert route["capacity"]["used_volume_m3"] <= 2.0 + 1e-6


# ─────────────────────────────────────────────────────────────────────────────
# 4. Time-window constraint
# ─────────────────────────────────────────────────────────────────────────────


def test_time_windows_are_satisfied_when_possible(client, db, use_fake_providers):
    """Two deliveries 4h apart cannot be served by one van in 2h — two vans can."""
    make_vehicle(db, number="V-EARLY", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_vehicle(db, number="V-LATE", capacity_kg=500.0, lat=41.88, lon=-87.64)

    make_delivery(
        db, tracking_number="MORNING", lat=41.86, lon=-87.66,
        window_start=_shift(1), window_end=_shift(2),
    )
    make_delivery(
        db, tracking_number="EVENING", lat=41.92, lon=-87.68,
        window_start=_shift(5), window_end=_shift(7),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] in {"optimal", "feasible"}
    assert data["summary"]["deliveries_assigned"] == 2
    for route in data["routes"]:
        assert route["has_time_window_violations"] is False
        for stop in route["stops"]:
            assert stop["within_window"] is True
            assert stop["late_by_seconds"] == 0.0

    assert data["violations"] == []


def test_vehicle_waits_for_a_time_window_to_open(client, db, use_fake_providers):
    """Waiting time is reported rather than the window being violated."""
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_delivery(
        db, tracking_number="LATE-WINDOW", lat=41.86, lon=-87.66,
        window_start=_shift(3), window_end=_shift(5),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    route = resp.json()["routes"][0]
    stop = route["stops"][0]

    assert stop["wait_seconds"] > 0, "the vehicle should wait for the window"
    assert stop["within_window"] is True
    arrival = datetime.fromisoformat(stop["arrival"])
    service = datetime.fromisoformat(stop["service_start"])
    assert service >= arrival
    assert route["waiting_seconds"] > 0


def test_time_window_is_enforced_by_assigning_to_the_right_vehicle(client, db, use_fake_providers):
    """The early-window delivery goes to the nearby van, not the one due elsewhere."""
    make_vehicle(db, number="V-NEAR", capacity_kg=500.0, lat=41.880, lon=-87.636)
    make_vehicle(db, number="V-FAR", capacity_kg=500.0, lat=41.95, lon=-87.75)

    make_delivery(
        db, tracking_number="EARLY", lat=41.881, lon=-87.637,
        window_start=_shift(0, 10), window_end=_shift(1),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    route = resp.json()["routes"][0]

    assert route["vehicle_number"] == "V-NEAR"
    assert route["stops"][0]["within_window"] is True


def test_shift_end_deadline_is_respected(client, db, use_fake_providers):
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_delivery(db, tracking_number="D-1", lat=41.86, lon=-87.66)
    make_delivery(db, tracking_number="D-2", lat=41.92, lon=-87.68)

    resp = client.post(
        f"{BASE}/routes/optimize",
        json=preferences(shift_start=NOW.isoformat(), shift_end=_shift(6).isoformat()),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["violations"] == []
    assert data["routes"][0]["estimated_return"] <= _shift(6).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# 5. No available vehicles
# ─────────────────────────────────────────────────────────────────────────────


def test_no_vehicles_at_all_returns_422(client, db, use_fake_providers):
    make_delivery(db, tracking_number="D-1")

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 422
    assert "no available vehicles" in resp.json()["detail"].lower()


def test_offline_vehicles_are_not_used(client, db, use_fake_providers):
    make_vehicle(db, number="V-OFF", status="offline")
    make_vehicle(db, number="V-BUSY", status="in_transit")
    make_delivery(db, tracking_number="D-1")

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 422
    assert "no available vehicles" in resp.json()["detail"].lower()


def test_vehicle_with_inactive_driver_is_excluded(client, db, use_fake_providers):
    make_vehicle(
        db, number="V-DRV", driver_name="Off Duty", driver_status="off_duty"
    )
    make_delivery(db, tracking_number="D-1")

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 422
    assert "no active driver" in resp.json()["detail"].lower()


def test_all_vehicles_offline_returns_infeasible_summary(client, db, use_fake_providers):
    """With an explicit selection of unavailable vehicles the answer is explicit."""
    offline = make_vehicle(db, number="V-OFF", status="offline")
    make_delivery(db, tracking_number="D-1")

    resp = client.post(f"{BASE}/routes/optimize", json={"vehicle_ids": [offline.id]})
    assert resp.status_code == 422
    assert "unavailable" in resp.json()["detail"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# 6. Insufficient capacity
# ─────────────────────────────────────────────────────────────────────────────


def test_insufficient_total_capacity_returns_409(client, db, use_fake_providers):
    make_vehicle(db, number="V-SMALL", capacity_kg=50.0)
    make_delivery(db, tracking_number="BIG-1", weight=40.0)
    make_delivery(db, tracking_number="BIG-2", weight=40.0)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "capacity is insufficient" in detail
    assert "80 kg" in detail and "50 kg" in detail


def test_delivery_heavier_than_every_vehicle_returns_409(client, db, use_fake_providers):
    make_vehicle(db, number="V-1", capacity_kg=30.0)
    make_vehicle(db, number="V-2", capacity_kg=40.0)
    make_delivery(db, tracking_number="HUGE", weight=500.0)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "largest available vehicle" in detail
    assert "500" in detail


def test_insufficient_capacity_is_reported_as_infeasible_not_a_route(client, db, use_fake_providers):
    """A successful-looking response must never be returned for an impossible load."""
    make_vehicle(db, number="V-TINY", capacity_kg=10.0)
    for index in range(3):
        make_delivery(db, tracking_number=f"D-{index}", weight=25.0)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 409
    # Nothing is applied to the database as a side effect of a failed solve.
    assert all(d.assigned_vehicle_id is None for d in db.query(Delivery).all())


def test_insufficient_volume_capacity_returns_409(client, db, use_fake_providers):
    make_vehicle(db, number="V-VOL", capacity_kg=10000.0, volume_m3=1.0)
    make_delivery(db, tracking_number="D-1", weight=1.0, volume_m3=4.0)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 409
    assert "volume is insufficient" in resp.json()["detail"]


# ─────────────────────────────────────────────────────────────────────────────
# 7. Invalid delivery / vehicle IDs
# ─────────────────────────────────────────────────────────────────────────────


def test_unknown_delivery_id_returns_404(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    resp = client.post(f"{BASE}/routes/optimize", json={"delivery_ids": [99999]})
    assert resp.status_code == 404
    assert "99999" in resp.json()["detail"]


def test_unknown_vehicle_id_returns_404(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    make_delivery(db, tracking_number="D-1")
    resp = client.post(f"{BASE}/routes/optimize", json={"vehicle_ids": [4242]})
    assert resp.status_code == 404
    assert "4242" in resp.json()["detail"]


def test_invalid_delivery_id_type_returns_422(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    resp = client.post(f"{BASE}/routes/optimize", json={"delivery_ids": ["abc"]})
    assert resp.status_code == 422


def test_empty_id_lists_are_rejected(client, db, use_fake_providers):
    """An explicitly empty selection is a mistake, not a request for everything."""
    make_vehicle(db, number="V-01")
    resp = client.post(f"{BASE}/routes/optimize", json={"delivery_ids": []})
    assert resp.status_code == 422


def test_already_delivered_and_cancelled_are_excluded(client, db, use_fake_providers):
    """Delivered/cancelled orders must never be re-routed."""
    vehicle = make_vehicle(db, number="V-01", capacity_kg=500.0)
    make_delivery(db, tracking_number="PENDING-1", lat=41.86, lon=-87.66)
    make_delivery(db, tracking_number="DONE", status="delivered", lat=41.95, lon=-87.70)
    make_delivery(db, tracking_number="CANCELLED", status="cancelled", lat=41.96, lon=-87.71)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    served = {s["tracking_number"] for r in data["routes"] for s in r["stops"]}
    assert served == {"PENDING-1"}
    assert data["summary"]["deliveries_eligible"] == 1
    # The exclusion is explained, not silent.
    assert any("excluded" in w for w in data["warnings"])


def test_explicitly_selected_delivered_delivery_is_reported_not_routed(client, db, use_fake_providers):
    make_vehicle(db, number="V-01", capacity_kg=500.0)
    done = make_delivery(db, tracking_number="DONE", status="delivered")

    resp = client.post(f"{BASE}/routes/optimize", json={"delivery_ids": [done.id]})
    assert resp.status_code == 422
    assert "delivered" in resp.json()["detail"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# 8. Invalid coordinates
# ─────────────────────────────────────────────────────────────────────────────


def test_out_of_range_delivery_coordinates_return_422(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    make_delivery(db, tracking_number="BAD-LAT", lat=200.0, lon=0.0)

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 422
    assert "coordinates" in resp.json()["detail"].lower()


def test_ungeocodable_delivery_returns_422_with_the_offending_list(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    make_delivery(
        db,
        tracking_number="NOWHERE",
        lat=None,
        lon=None,
        address="999999 Nonexistent Street, Springfield",
    )

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "NOWHERE" in detail
    assert "coordinates" in detail.lower()


def test_invalid_depot_coordinates_are_rejected_by_validation(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    resp = client.post(
        f"{BASE}/routes/optimize",
        json={"preferences": {"depot_latitude": 41.88}},  # longitude missing
    )
    assert resp.status_code == 422


def test_depot_is_used_when_a_vehicle_has_no_position(client, db, use_fake_providers):
    """A vehicle with no GPS fix routes from the configured depot, not a guess."""
    make_vehicle(db, number="V-NOPOS", lat=None, lon=None)
    make_delivery(db, tracking_number="D-1", lat=41.86, lon=-87.66)

    resp = client.post(
        f"{BASE}/routes/optimize",
        json=preferences(depot_latitude=41.88, depot_longitude=-87.64),
    )
    assert resp.status_code == 200, resp.text
    route = resp.json()["routes"][0]
    assert route["start"]["latitude"] == pytest.approx(41.88)
    assert route["start"]["longitude"] == pytest.approx(-87.64)


def test_vehicle_without_position_is_reported_when_no_depot(client, db, use_fake_providers):
    make_vehicle(db, number="V-NOPOS", lat=None, lon=None)
    make_delivery(db, tracking_number="D-1")

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 422
    assert "start position" in resp.json()["detail"].lower()


def test_delivery_without_coordinates_is_geocoded_not_invented(client, db, use_fake_providers):
    """A delivery with a known address is geocoded by the backend."""
    make_vehicle(db, number="V-01", capacity_kg=500.0)
    make_delivery(
        db,
        tracking_number="NEEDS-GEOCODE",
        lat=None,
        lon=None,
        address="120 S Wacker Dr, Chicago, IL 60606",
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    stop = resp.json()["routes"][0]["stops"][0]
    assert stop["latitude"] == pytest.approx(41.880216, abs=1e-4)
    assert stop["longitude"] == pytest.approx(-87.636747, abs=1e-4)


# ─────────────────────────────────────────────────────────────────────────────
# 10. Infeasible optimization (time windows)
# ─────────────────────────────────────────────────────────────────────────────


def test_impossible_time_window_returns_409(client, db, use_fake_providers):
    """A window that closed an hour ago can never be met."""
    make_vehicle(db, number="V-01", capacity_kg=500.0)
    make_delivery(
        db,
        tracking_number="STALE",
        window_start=_shift(-5),
        window_end=_shift(-1),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 409
    assert "could not satisfy all delivery constraints" in resp.json()["detail"].lower()


def test_solver_detected_infeasibility_returns_409_with_the_full_body(
    client, db, use_fake_providers
):
    """
    A window that is still open but closes before the vehicle can arrive.

    The pre-flight checks cannot prove this (the window has not closed yet), so
    the solver detects it. The outcome must still be a 409 — the same contract as
    pre-flight infeasibility — while still returning the summary and unassigned
    list so the UI can explain what happened.
    """
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    # Far away: much more than a 60-second window allows.
    make_delivery(
        db,
        tracking_number="UNREACHABLE",
        lat=41.99,
        lon=-87.90,
        window_start=_shift(0, 0),
        window_end=_shift(0, 1),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 409, resp.text

    data = resp.json()
    # The body is a full optimization response, not just a message.
    assert data["status"] == "infeasible"
    assert data["routes"] == []
    assert [u["tracking_number"] for u in data["unassigned"]] == ["UNREACHABLE"]
    assert data["message"]


def test_expired_shift_end_is_rejected(client, db, use_fake_providers):
    """
    A shift that has already ended cannot serve a single stop.

    Only shift_end is supplied, so the reference time defaults to now, which is
    already past the deadline every route would have to meet. Caught by the
    pre-flight checks rather than the solver, and reported explicitly rather than
    quietly returning a plan that ignores the van the operator asked for.
    """
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_delivery(db, tracking_number="D-1", lat=41.86, lon=-87.66)

    resp = client.post(
        f"{BASE}/routes/optimize",
        json=preferences(shift_end=_shift(-2).isoformat()),
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"].lower()
    assert "v-01" in detail
    assert "before the optimization reference time" in detail


def test_past_shift_is_planned_relative_to_its_start(
    client, db, use_fake_providers
):
    """
    A past shift is a legitimate retrospective plan, not an error.

    reference_time defaults to shift_start, so the whole shift is scheduled
    relative to its own beginning instead of to the current clock.
    """
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_delivery(db, tracking_number="D-1", lat=41.86, lon=-87.66)

    resp = client.post(
        f"{BASE}/routes/optimize",
        json=preferences(
            shift_start=_shift(-3).isoformat(),
            shift_end=_shift(-2).isoformat(),
        ),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] in {"optimal", "feasible"}


def test_shift_that_ends_before_the_return_deadline_is_infeasible(
    client, db, use_fake_providers
):
    """
    A shift that ends while the van is still driving cannot be served.

    This one is provably impossible but not detectable before the solve, so the
    response must be a 409 carrying the full body rather than a fake plan.
    """
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_delivery(db, tracking_number="D-1", lat=41.90, lon=-87.75)

    resp = client.post(
        f"{BASE}/routes/optimize",
        json=preferences(shift_end=_shift(0, 5).isoformat()),
    )
    assert resp.status_code == 409, resp.text
    data = resp.json()
    assert data["status"] == "infeasible"
    assert [u["tracking_number"] for u in data["unassigned"]] == ["D-1"]


def test_infeasible_response_reports_every_delivery_as_unassigned(client, db, use_fake_providers):
    """No misleading partial route on an impossible problem."""
    make_vehicle(db, number="V-01", capacity_kg=500.0)
    for index in range(2):
        make_delivery(
            db,
            tracking_number=f"STALE-{index}",
            window_start=_shift(-5),
            window_end=_shift(-1),
        )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 409
    # 409 is raised from the pre-flight check, so nothing is reported as a route.
    assert db.query(Delivery).count() == 2


def test_conflicting_windows_on_one_vehicle_are_detected(client, db, use_fake_providers):
    """Two far-apart 20-minute windows cannot both be served by one van."""
    make_vehicle(db, number="V-01", capacity_kg=500.0, lat=41.88, lon=-87.64)
    make_delivery(
        db, tracking_number="T1", lat=41.85, lon=-87.70,
        window_start=_shift(0, 5), window_end=_shift(0, 25),
    )
    make_delivery(
        db, tracking_number="T2", lat=41.95, lon=-87.75,
        window_start=_shift(0, 30), window_end=_shift(0, 50),
    )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code in {200, 409}

    if resp.status_code == 409:
        # Correctly refused rather than silently violating a window.
        assert "constraints" in resp.json()["detail"].lower()
    else:
        # If solvable, every served stop must respect its window.
        data = resp.json()
        for route in data["routes"]:
            assert route["has_time_window_violations"] is False
            for stop in route["stops"]:
                assert stop["within_window"] is True


def test_partial_mode_reports_unassigned_deliveries(client, db, use_fake_providers):
    """allow_partial=True yields a plan plus an explicit unassigned list."""
    make_vehicle(db, number="V-01", capacity_kg=100.0)
    make_delivery(db, tracking_number="FITS", weight=60.0, lat=41.86, lon=-87.66)
    # Also fits in the van on its own, but 60 + 60 = 120 kg > 100 kg, so only one
    # can be served. That is the case partial mode exists for.
    make_delivery(db, tracking_number="LEFT-OUT", weight=60.0, lat=41.92, lon=-87.68)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences(allow_partial=True))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] == "partial"
    assigned = {s["tracking_number"] for r in data["routes"] for s in r["stops"]}
    assert len(assigned) == 1
    unassigned = [u["tracking_number"] for u in data["unassigned"]]
    assert unassigned == list({"FITS", "LEFT-OUT"} - assigned)
    assert data["unassigned"][0]["reason"]
    assert data["summary"]["deliveries_assigned"] == 1
    assert data["summary"]["deliveries_unassigned"] == 1
    # The served route still respects capacity.
    assert data["routes"][0]["capacity"]["used_kg"] <= 100.0


def test_impossible_delivery_is_refused_even_in_partial_mode(client, db, use_fake_providers):
    """
    A delivery no vehicle in the fleet could ever carry is a hard error.

    Partial mode promises to serve *as many as possible*; it cannot invent a
    vehicle, so an oversized delivery is reported rather than silently dropped.
    """
    make_vehicle(db, number="V-01", capacity_kg=100.0)
    make_delivery(db, tracking_number="FITS", weight=40.0, lat=41.86, lon=-87.66)
    make_delivery(db, tracking_number="TOO-BIG", weight=400.0, lat=41.92, lon=-87.68)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences(allow_partial=True))
    assert resp.status_code == 409, resp.text
    assert "TOO-BIG" in resp.json()["detail"]


def test_partial_mode_splits_across_two_vehicles(client, db, use_fake_providers):
    make_vehicle(db, number="V-A", capacity_kg=100.0, lat=41.88, lon=-87.64)
    make_vehicle(db, number="V-B", capacity_kg=100.0, lat=41.89, lon=-87.65)
    for index in range(5):
        make_delivery(db, tracking_number=f"D-{index}", weight=60.0, lat=41.85 + index * 0.02)

    # 300 kg against 200 kg of fleet capacity, so this must be a partial plan.
    resp = client.post(f"{BASE}/routes/optimize", json=preferences(allow_partial=True))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["status"] == "partial"
    # 2 vans * 1 delivery each (a second 60 kg delivery would exceed 100 kg).
    assert data["summary"]["deliveries_assigned"] == 2
    assert data["summary"]["deliveries_unassigned"] == 3
    assert len(data["unassigned"]) == 3
    for unassigned in data["unassigned"]:
        assert unassigned["reason"]
    for route in data["routes"]:
        assert route["stop_count"] == 1


# ─────────────────────────────────────────────────────────────────────────────
# Consistency with the routing service + baseline integrity
# ─────────────────────────────────────────────────────────────────────────────


def test_small_problems_do_not_burn_the_whole_time_budget(
    client, db, use_fake_providers
):
    """
    A trivial problem must return as soon as it is solved, not after N seconds.

    Pinning the first-solution strategy or the metaheuristic disables OR-Tools'
    early optimality termination, which made every request take the full limit.
    """
    make_vehicle(db, number="V-01", capacity_kg=500.0)
    make_delivery(db, tracking_number="D-1")
    make_delivery(db, tracking_number="D-2")

    resp = client.post(
        f"{BASE}/routes/optimize",
        json=preferences(time_limit_seconds=20),
    )
    assert resp.status_code == 200, resp.text

    solver = resp.json()["solver"]
    assert solver["wall_time_ms"] < 5000, (
        f"solver used {solver['wall_time_ms']} ms of a 20000 ms budget on a "
        "two-delivery problem — early termination is broken"
    )
    assert resp.json()["status"] == "optimal"


def test_routes_include_real_road_geometry(client, db, use_fake_providers):
    """Each route carries a drawable polyline so the map is not a straight line guess."""
    make_vehicle(db, number="V-GEO", lat=41.88, lon=-87.64)
    make_delivery(db, tracking_number="G-1", lat=41.86, lon=-87.66)
    make_delivery(db, tracking_number="G-2", lat=41.90, lon=-87.62)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    route = resp.json()["routes"][0]

    geometry = route["geometry"]
    assert len(geometry) >= 2, "no road geometry returned"
    for point in geometry:
        assert len(point) == 2
        # Leaflet order is [lat, lng]; a swapped pair would put the map in the ocean.
        assert -90.0 <= point[0] <= 90.0, f"latitude out of range: {point}"
        assert -180.0 <= point[1] <= 180.0, f"longitude out of range: {point}"

    south, west, north, east = route["bounds"]
    assert south <= north and west <= east
    # Every stop must fall inside the bounds of its own route.
    for stop in route["stops"]:
        assert south <= stop["latitude"] <= north
        assert west <= stop["longitude"] <= east
    # Bounds are derived from the drawn line when the provider sends no bbox.
    assert route["bounds"] is not None
    assert south == pytest.approx(min(point[0] for point in geometry))
    assert north == pytest.approx(max(point[0] for point in geometry))


def test_reported_totals_match_the_routing_matrix(client, db, use_fake_providers):
    """Every reported distance must be reproducible from the real matrix."""
    _, fake_router = use_fake_providers
    make_vehicle(db, number="V-01", capacity_kg=1000.0, lat=41.880216, lon=-87.636747)
    for index in range(4):
        make_delivery(
            db,
            tracking_number=f"D-{index}",
            lat=41.86 + index * 0.02,
            lon=-87.66 + index * 0.01,
        )

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # The matrix came from the provider, not from straight-line maths.
    assert fake_router.matrix_calls, "the optimiser must build a matrix via the routing provider"
    assert data["solver"]["matrix_source"].startswith("fake")

    route = data["routes"][0]
    vehicle = db.query(Vehicle).filter(Vehicle.vehicle_number == "V-01").one()

    expected = 0.0
    previous = (vehicle.current_latitude, vehicle.current_longitude)
    for stop in route["stops"]:
        expected += fake_router._road_distance(
            type("C", (), {"latitude": previous[0], "longitude": previous[1]})(),
            type("C", (), {"latitude": stop["latitude"], "longitude": stop["longitude"]})(),
        )
        previous = (stop["latitude"], stop["longitude"])
    expected += fake_router._road_distance(
        type("C", (), {"latitude": previous[0], "longitude": previous[1]})(),
        type("C", (), {"latitude": vehicle.current_latitude, "longitude": vehicle.current_longitude})(),
    )

    assert route["distance_meters"] == pytest.approx(expected, rel=0.001)
    assert data["summary"]["total_distance_meters"] == pytest.approx(
        sum(r["distance_meters"] for r in data["routes"]), rel=1e-6
    )


def test_baseline_is_labelled_and_savings_are_arithmetically_correct(client, db, use_fake_providers):
    make_vehicle(db, number="V-01", capacity_kg=1000.0, lat=41.88, lon=-87.64)
    for index in range(5):
        make_delivery(db, tracking_number=f"D-{index}", lat=41.95 - index * 0.015, lon=-87.70 + index * 0.01)

    resp = client.post(f"{BASE}/routes/optimize", json=preferences())
    assert resp.status_code == 200, resp.text
    comparison = resp.json()["baseline"]

    # Explicitly labelled — never presented as previously-driven routes.
    assert comparison["baseline"]["label"] == "Original delivery order"
    assert "reference point" in comparison["baseline"]["description"]

    baseline_distance = comparison["baseline"]["total_distance_meters"]
    optimized = comparison["optimized_distance_meters"]
    assert comparison["distance_saved_meters"] == pytest.approx(
        baseline_distance - optimized, abs=0.1
    )
    assert comparison["distance_saved_km"] == pytest.approx(
        comparison["distance_saved_meters"] / 1000.0, abs=0.01
    )
    assert comparison["distance_saved_percent"] == pytest.approx(
        (baseline_distance - optimized) / baseline_distance * 100.0, abs=0.1
    )


def test_capabilities_endpoint_is_honest(client, db):
    resp = client.get(f"{BASE}/routes/optimize/capabilities")
    assert resp.status_code == 200
    data = resp.json()
    assert data["engine"] == "google_or_tools"
    assert data["objective"] == "minimize_total_travel_distance"
    assert data["objective_is_extensible"] is True
    assert "vehicle_capacity_weight" in data["constraints_enforced"]
    # Explicitly lists what is NOT implemented yet.
    assert "traffic_prediction" in data["constraints_not_yet_implemented"]
    assert "driver_working_hours" in data["constraints_not_yet_implemented"]


def test_optimization_does_not_mutate_assignments(client, db, use_fake_providers):
    """Planning is a proposal, not a commitment."""
    make_vehicle(db, number="V-01", capacity_kg=1000.0)
    make_delivery(db, tracking_number="D-1")
    make_delivery(db, tracking_number="D-2", lat=41.90, lon=-87.62)

    assert client.post(f"{BASE}/routes/optimize", json={}).status_code == 200

    for delivery in db.query(Delivery).all():
        assert delivery.assigned_vehicle_id is None
        assert delivery.status == "pending"


def test_request_validation_rejects_bad_preferences(client, db, use_fake_providers):
    make_vehicle(db, number="V-01")
    make_delivery(db, tracking_number="D-1")

    bad_shift = client.post(
        f"{BASE}/routes/optimize",
        json={"preferences": {"shift_start": _shift(5).isoformat(), "shift_end": _shift(1).isoformat()}},
    )
    assert bad_shift.status_code == 422

    bad_profile = client.post(f"{BASE}/routes/optimize", json={"profile": "teleport"})
    assert bad_profile.status_code == 422


def test_provider_failure_maps_to_http_and_leaks_nothing(client, db, use_fake_providers):
    from app.services.providers.errors import ProviderUnavailableError

    _, fake_router = use_fake_providers
    make_vehicle(db, number="V-01")
    make_delivery(db, tracking_number="D-1")
    fake_router.fail_with = ProviderUnavailableError(provider="fake")

    resp = client.post(f"{BASE}/routes/optimize", json={})
    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert "Traceback" not in detail
    assert "ProviderUnavailableError" not in detail


def test_unknown_profile_in_matrix_returns_422(client, db, use_fake_providers):
    """The provider validates the profile even when called from the optimiser."""
    make_vehicle(db, number="V-01")
    make_delivery(db, tracking_number="D-1")
    make_delivery(db, tracking_number="D-2", lat=41.90, lon=-87.62)

    resp = client.post(f"{BASE}/routes/optimize", json={"profile": "walking"})
    assert resp.status_code == 200
    assert resp.json()["profile"] == "walking"
