"""Shared fixtures.

Every test gets its own database — a SQLite database held in memory, which is
the real storage implementation rather than a stand-in, so the tests exercise
the SQL the server actually runs. It is created and thrown away per test, so
nothing leaks between cases.
"""

import pytest
from fastapi.testclient import TestClient

from quits.app import create_app
from quits.sql import create_database_factory


@pytest.fixture
def database_factory():
    """A private in-memory SQLite database, schema created."""
    return create_database_factory("sqlite://")


@pytest.fixture
def client(database_factory) -> TestClient:
    return TestClient(create_app(database_factory))


@pytest.fixture
def trip(client: TestClient) -> dict:
    """A trip created by Anna. Returns {token, trip, anna}."""
    response = client.post(
        "/api/trips",
        json={"name": "Lisbon", "currencyLabel": "EUR", "creatorName": "Anna"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return {
        "token": body["trip"]["token"],
        "trip": body["trip"],
        "anna": body["participant"],
    }


@pytest.fixture
def trio(client: TestClient, trip: dict) -> dict:
    """Anna, Max and Sam, in that creation order."""
    token = trip["token"]
    max_ = client.post(f"/api/trips/{token}/participants", json={"name": "Max"}).json()
    sam = client.post(f"/api/trips/{token}/participants", json={"name": "Sam"}).json()
    return {**trip, "max": max_, "sam": sam}


def expense_payload(anna_id: str, **overrides) -> dict:
    """The shape the frontend actually sends — every key, every time."""
    payload = {
        "description": "Dinner",
        "amountCents": 1000,
        "paidBy": anna_id,
        "date": "2026-09-20",
        "category": None,
        "splitType": "equal",
        "participantIds": [anna_id],
        "exactCents": {},
        "basisPoints": {},
        "createdBy": anna_id,
    }
    payload.update(overrides)
    return payload
