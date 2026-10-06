"""
============================================================
DEVELOPMENT / DEMO DATA RESET + SEED SCRIPT
============================================================

⚠️  WARNING: This script RESETS the development database and
    creates a small demo dataset. Do NOT run in production.

Usage:
    cd backend
    python seed.py

What it does:
    1. Deletes every existing delivery, vehicle, driver and
       tracking record. RouteIQ is meant to be driven by data
       the user enters, so the old demo data is removed rather
       than added to.
    2. Inserts a small, clean Bangalore (Karnataka, India)
       dataset: 3 drivers, 3 vehicles and 4 deliveries.

Delivery time windows are anchored to the moment the script
runs, so re-run it immediately before a walkthrough.
============================================================
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

# The status lines below use symbols such as ⚠️ and ✅. A default Windows console
# is cp1252 and raises UnicodeEncodeError on them, which aborted the seed before
# any work was done. Force UTF-8 output so the script runs on every platform.
for stream in (sys.stdout, sys.stderr):
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace")

# Ensure the backend root is on sys.path
backend_root = Path(__file__).parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from app.core.database import SessionLocal, engine, Base
import app.models  # noqa: F401 – register all models with SQLAlchemy
from app.models.driver import Driver
from app.models.vehicle import Vehicle
from app.models.delivery import Delivery
from app.models.tracking import TrackingRecord


def reset_data(db) -> None:
    """
    Remove all operational rows so the demo starts clean.

    Order matters only for readability — the FKs are ON DELETE SET NULL /
    CASCADE — but deleting children first keeps the intent obvious.
    """
    removed_tracking = db.query(TrackingRecord).delete()
    removed_deliveries = db.query(Delivery).delete()
    removed_vehicles = db.query(Vehicle).delete()
    removed_drivers = db.query(Driver).delete()
    db.commit()
    print(
        f"  ✓ Cleared existing data "
        f"(deliveries {removed_deliveries}, vehicles {removed_vehicles}, "
        f"drivers {removed_drivers}, tracking records {removed_tracking})"
    )


def seed_drivers(db) -> list[Driver]:
    """Seed a small set of Bengaluru delivery drivers."""
    driver_data = [
        {"name": "Arjun Reddy",  "phone": "+91 98860 12345", "status": "active"},
        {"name": "Priya Nair",   "phone": "+91 98450 23456", "status": "active"},
        {"name": "Vikram Singh", "phone": "+91 99000 34567", "status": "off_duty"},
    ]

    drivers = []
    for d in driver_data:
        obj = Driver(**d)
        db.add(obj)
        db.flush()
        drivers.append(obj)
    db.commit()
    print(f"  ✓ Seeded {len(drivers)} drivers")
    return drivers


def seed_vehicles(db, drivers: list[Driver]) -> list[Vehicle]:
    """
    Seed a small Bengaluru fleet. Two vehicles are tracked and carry their
    current stored position (the depot / a nearby area); one is left untracked
    to exercise the honest "not being tracked" state on the map.
    """
    vehicle_data = [
        {
            "vehicle_number": "V-101",
            "name": "Bengaluru Express Van",
            "license_plate": "KA-01-AB-1234",
            "vehicle_type": "van",
            "capacity_kg": 800.0,
            "capacity_volume_m3": 5.0,
            "status": "active",
            "tracking_enabled": True,          # ← tracked
            "current_latitude": 12.9716,       # Bengaluru Central Depot (MG Road)
            "current_longitude": 77.5946,
            "driver_id": drivers[0].id,
        },
        {
            "vehicle_number": "V-102",
            "name": "City Cargo Truck",
            "license_plate": "KA-02-CD-5678",
            "vehicle_type": "truck",
            "capacity_kg": 2500.0,
            "capacity_volume_m3": 16.0,
            "status": "active",
            "tracking_enabled": True,          # ← tracked
            "current_latitude": 12.9352,       # Koramangala
            "current_longitude": 77.6245,
            "driver_id": drivers[1].id,
        },
        {
            "vehicle_number": "V-103",
            "name": "Last-Mile E-Bike",
            "license_plate": "KA-03-EF-9012",
            "vehicle_type": "bike",
            "capacity_kg": 50.0,
            "capacity_volume_m3": 0.5,
            "status": "available",
            "tracking_enabled": False,         # ← not tracked (demonstrates empty state)
            "current_latitude": 12.9784,       # Indiranagar
            "current_longitude": 77.6408,
            "driver_id": drivers[2].id,
        },
    ]

    vehicles = []
    for v_data in vehicle_data:
        obj = Vehicle(**v_data)
        db.add(obj)
        db.flush()
        vehicles.append(obj)
    db.commit()
    print(f"  ✓ Seeded {len(vehicles)} vehicles")
    return vehicles


def seed_deliveries(db, vehicles: list[Vehicle]) -> list[Delivery]:
    """
    Seed a handful of Bengaluru deliveries.

    Time windows are relative to the moment the script runs rather than
    hardcoded dates, so the demo never shows windows that closed last week.
    Three shapes are represented on purpose, because the planner treats each
    differently:
      "open"  – open now, the normal case
      "tight" – closes shortly, which is what the delay alerts key off
      "later" – not open yet, so the solver has to wait for it
    Every window is left satisfiable so that selecting every delivery produces a
    feasible plan. One delivery is left without a window to show "No time
    window", and one is already delivered so the dashboard has a completed job.
    """
    v_map = {v.vehicle_number: v for v in vehicles}

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    window_specs = {
        "RT-1002": (now - timedelta(minutes=30), now + timedelta(hours=2)),   # open
        "RT-1003": (now - timedelta(minutes=20), now + timedelta(minutes=25)),  # tight
        "RT-1004": (now + timedelta(hours=1), now + timedelta(hours=5)),      # not yet open
    }

    delivery_data = [
        {
            "tracking_number": "RT-1001",
            "customer_name": "Indiranagar Retail Hub",
            "phone": "+91 80 4123 1001",
            "address": "100 Feet Road, Indiranagar, Bengaluru 560038",
            "latitude": 12.9784,
            "longitude": 77.6408,
            "package_weight": 12.0,
            "volume_m3": 0.15,
            "priority": "normal",
            "status": "delivered",
            "notes": "Signed for at the front desk.",
            "assigned_vehicle_id": v_map["V-101"].id,
        },
        {
            "tracking_number": "RT-1002",
            "customer_name": "Koramangala Pharmacy",
            "phone": "+91 80 4123 1002",
            "address": "80 Feet Road, Koramangala 4th Block, Bengaluru 560034",
            "latitude": 12.9352,
            "longitude": 77.6245,
            "package_weight": 8.0,
            "volume_m3": 0.08,
            "priority": "high",
            "status": "in_transit",
            "notes": "Temperature-sensitive medicines — keep upright.",
            "assigned_vehicle_id": v_map["V-102"].id,
        },
        {
            "tracking_number": "RT-1003",
            "customer_name": "MG Road Business Park",
            "phone": "+91 80 4123 1003",
            "address": "MG Road, Bengaluru 560001",
            "latitude": 12.9756,
            "longitude": 77.6068,
            "package_weight": 45.0,
            "volume_m3": 0.45,
            "priority": "urgent",
            "status": "in_transit",
            "notes": "Deliver to reception, ground floor.",
            "assigned_vehicle_id": v_map["V-101"].id,
        },
        {
            "tracking_number": "RT-1004",
            "customer_name": "Whitefield Logistics Park",
            "phone": "+91 80 4123 1004",
            "address": "Whitefield Main Road, Bengaluru 560066",
            "latitude": 12.9698,
            "longitude": 77.7500,
            "package_weight": 120.0,
            "volume_m3": 1.20,
            "priority": "high",
            "status": "pending",
            "notes": "Awaiting route allocation in the next optimization run.",
            "assigned_vehicle_id": None,
        },
    ]

    deliveries = []
    for d_data in delivery_data:
        window = window_specs.get(d_data["tracking_number"])
        if window:
            d_data["time_window_start"], d_data["time_window_end"] = window
        obj = Delivery(**d_data)
        db.add(obj)
        db.flush()
        deliveries.append(obj)
    db.commit()
    with_window = sum(1 for d in deliveries if d.time_window_start)
    print(f"  ✓ Seeded {len(deliveries)} deliveries ({with_window} with a time window)")
    return deliveries


def run_seed():
    print("\n" + "=" * 60)
    print("  RouteIQ DEVELOPMENT DATA RESET + SEED")
    print("  ⚠️  FOR DEVELOPMENT / DEMO USE ONLY")
    print("=" * 60)

    # Ensure tables exist (in case migrations haven't been run yet)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        print("\n🌱 Resetting and seeding Bengaluru demo data...")
        reset_data(db)
        drivers = seed_drivers(db)
        vehicles = seed_vehicles(db, drivers)
        deliveries = seed_deliveries(db, vehicles)

        tracked = sum(1 for v in vehicles if v.tracking_enabled)
        print(f"\n✅ Seed complete!")
        print(f"   Drivers:   {len(drivers)}")
        print(f"   Vehicles:  {len(vehicles)} ({tracked} with tracking enabled)")
        print(f"   Deliveries:{len(deliveries)}")
        print(f"\n🚀 Start the backend: python -m uvicorn app.main:app --reload --port 8000")
        print("=" * 60 + "\n")
        print(
            "Note: delivery time windows are anchored to the moment this script "
            "ran, not to a fixed calendar date. They are stored as absolute UTC "
            "timestamps, so a demo database left overnight will have every window "
            "in the past and 'select all' in the Route Planner will correctly "
            "report that no plan is feasible. Re-run `python seed.py` immediately "
            "before a demo to re-anchor the windows to the present."
        )
        print()
    except Exception as e:
        db.rollback()
        print(f"\n❌ Seed failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run_seed()