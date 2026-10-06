"""
Tests for vehicle API endpoints.
"""

import pytest


BASE = "/api/v1"

VEHICLE_PAYLOAD = {
    "vehicle_number": "V-TEST-01",
    "name": "Test Van Alpha",
    "license_plate": "TEST-001",
    "vehicle_type": "van",
    "capacity_kg": 1000.0,
    "capacity_volume_m3": 8.0,
    "status": "available",
    "tracking_enabled": False,
}


def test_create_vehicle(client):
    resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["vehicle_number"] == "V-TEST-01"
    assert data["tracking_enabled"] is False
    assert "id" in data


def test_create_vehicle_conflict(client):
    """Creating the same vehicle_number twice should return 409."""
    client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    assert resp.status_code == 409


def test_list_vehicles(client):
    client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    resp = client.get(f"{BASE}/vehicles")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_get_vehicle(client):
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    resp = client.get(f"{BASE}/vehicles/{vehicle_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == vehicle_id


def test_get_vehicle_not_found(client):
    resp = client.get(f"{BASE}/vehicles/99999")
    assert resp.status_code == 404


def test_update_vehicle(client):
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    resp = client.put(f"{BASE}/vehicles/{vehicle_id}", json={"status": "active"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


def test_delete_vehicle(client):
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    del_resp = client.delete(f"{BASE}/vehicles/{vehicle_id}")
    assert del_resp.status_code == 204

    get_resp = client.get(f"{BASE}/vehicles/{vehicle_id}")
    assert get_resp.status_code == 404


def test_start_tracking(client):
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    resp = client.post(f"{BASE}/tracking/vehicles/{vehicle_id}/start")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tracking_enabled"] is True
    assert data["vehicle_id"] == vehicle_id


def test_stop_tracking(client):
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    client.post(f"{BASE}/tracking/vehicles/{vehicle_id}/start")

    resp = client.post(f"{BASE}/tracking/vehicles/{vehicle_id}/stop")
    assert resp.status_code == 200
    assert resp.json()["tracking_enabled"] is False


def test_start_tracking_invalid_id(client):
    resp = client.post(f"{BASE}/tracking/vehicles/99999/start")
    assert resp.status_code == 404


def test_list_tracked_vehicles(client):
    """Only vehicles with tracking_enabled=True should appear."""
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    # Before tracking: should be empty
    resp = client.get(f"{BASE}/tracking/vehicles")
    assert resp.status_code == 200
    assert len(resp.json()) == 0

    # After starting: should appear
    client.post(f"{BASE}/tracking/vehicles/{vehicle_id}/start")
    resp = client.get(f"{BASE}/tracking/vehicles")
    assert len(resp.json()) == 1


def test_start_tracking_idempotent(client):
    """Calling start twice should not raise an error."""
    create_resp = client.post(f"{BASE}/vehicles", json=VEHICLE_PAYLOAD)
    vehicle_id = create_resp.json()["id"]

    r1 = client.post(f"{BASE}/tracking/vehicles/{vehicle_id}/start")
    r2 = client.post(f"{BASE}/tracking/vehicles/{vehicle_id}/start")
    assert r1.status_code == 200
    assert r2.status_code == 200
