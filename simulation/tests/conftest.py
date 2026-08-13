from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from furima_sim.api import app, registry


@pytest.fixture
def snapshot() -> dict:
    return {
        "version": "1",
        "stateVersion": 7,
        "currentUserId": "user-buyer",
        "users": [
            {
                "id": "user-buyer",
                "displayName": "Haruka",
                "salesBalance": 1_000,
                "points": 500,
                "persona": {
                    "budget": 18_000,
                    "interests": ["audio", "fashion"],
                    "priceSensitivity": 0.8,
                    "negotiationTendency": 0.7,
                    "impulsiveness": 0.65,
                    "activityHours": list(range(24)),
                },
                "actorType": "npc",
            },
            {
                "id": "user-seller",
                "displayName": "Sakura",
                "salesBalance": 20_000,
                "points": 100,
                "budget": 12_000,
                "interests": ["books"],
                "priceSensitivity": 0.4,
                "negotiationTendency": 0.3,
                "impulsiveness": 0.2,
                "activityHours": list(range(24)),
                "actorType": "npc",
            },
        ],
        "items": [
            {
                "id": "item-audio",
                "title": "Wireless audio headphones",
                "description": "Noise cancelling audio device",
            },
            {
                "id": "item-book",
                "title": "Python simulation book",
                "description": "An introduction to agent models",
            },
        ],
        "listings": [
            {
                "id": "listing-audio",
                "itemId": "item-audio",
                "sellerId": "user-seller",
                "categoryId": "audio",
                "price": 9_800,
                "status": "PUBLISHED",
                "availability": "AVAILABLE",
                "saleType": "FIXED_PRICE",
                "version": 2,
                "likesCount": 3,
            },
            {
                "id": "listing-book",
                "itemId": "item-book",
                "sellerId": "user-buyer",
                "categoryId": "books",
                "price": 1_200,
                "status": "PUBLISHED",
                "availability": "AVAILABLE",
                "saleType": "FIXED_PRICE",
                "version": 1,
                "likesCount": 0,
            },
        ],
        "transactions": [],
        "likes": [],
    }


@pytest.fixture
def snapshot_copy(snapshot: dict) -> dict:
    return copy.deepcopy(snapshot)


@pytest.fixture
def client() -> TestClient:
    registry.clear()
    with TestClient(app) as test_client:
        yield test_client
    registry.clear()
