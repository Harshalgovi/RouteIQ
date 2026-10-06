"""
Tests for delivery API endpoints.
"""

import pytest


BASE = "/api/v1"

DELIVERY_PAYLOAD = {
    "tracking_number": "RT-TEST-001",
    "customer_name": "Test Corp",
    "phone": "+1 (555) 000-0001",
    "address": "1 Test Street, Chicago, IL 60601",
    "latitude": 41.8781,
    "longitude": -87.6298,
    "package_weight": 10.0,
    "volume_m3": 0.2,
    "priority": "normal",
    "status": "pending",
    "notes": "Test delivery order",
    "assigned_vehicle_id": None,
}


def test_create_delivery(client):
    resp = client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["tracking_number"] == "RT-TEST-001"
    assert data["status"] == "pending"
    assert "id" in data


def test_create_delivery_invalid_data(client):
    """Sending incomplete data should return 422 Unprocessable Entity."""
    resp = client.post(f"{BASE}/deliveries", json={"tracking_number": "ONLY-TN"})
    assert resp.status_code == 422


def test_create_delivery_conflict(client):
    """Duplicate tracking_number should return 409."""
    client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    resp = client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    assert resp.status_code == 409


def test_list_deliveries(client):
    client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    resp = client.get(f"{BASE}/deliveries")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_get_delivery(client):
    create_resp = client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    delivery_id = create_resp.json()["id"]

    resp = client.get(f"{BASE}/deliveries/{delivery_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == delivery_id


def test_get_delivery_not_found(client):
    resp = client.get(f"{BASE}/deliveries/99999")
    assert resp.status_code == 404


def test_update_delivery_status(client):
    create_resp = client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    delivery_id = create_resp.json()["id"]

    resp = client.put(f"{BASE}/deliveries/{delivery_id}", json={"status": "in_transit"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_transit"


def test_delete_delivery(client):
    create_resp = client.post(f"{BASE}/deliveries", json=DELIVERY_PAYLOAD)
    delivery_id = create_resp.json()["id"]

    del_resp = client.delete(f"{BASE}/deliveries/{delivery_id}")
    assert del_resp.status_code == 204

    get_resp = client.get(f"{BASE}/deliveries/{delivery_id}")
    assert get_resp.status_code == 404
