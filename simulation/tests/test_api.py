from __future__ import annotations

import mesa
from fastapi.testclient import TestClient


def bootstrap(
    client: TestClient, snapshot: dict, *, world_id: str = "api-world"
) -> dict:
    response = client.post(
        "/worlds/bootstrap",
        json={"world_id": world_id, "seed": 12345, "snapshot": snapshot},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_health_reports_pinned_mesa_engine(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "mesa_version": mesa.__version__,
        "engine": "mesa-3.5.1-agentset",
    }
    assert mesa.__version__ == "3.5.1"


def test_bootstrap_and_step_response_contract(
    client: TestClient, snapshot: dict
) -> None:
    summary = bootstrap(client, snapshot)
    assert summary["world_id"] == "api-world"
    assert summary["seed"] == 12345
    assert summary["participants"] == 2
    assert summary["metrics"]["listings"] == 2

    response = client.post(
        "/worlds/api-world/step",
        json={"steps": 3, "speed": 60, "snapshot": snapshot},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {
        "world_id",
        "seed",
        "steps",
        "speed",
        "command_intents",
        "events",
        "metrics",
    }
    assert payload["events"]
    assert [event["caused_by"] for event in payload["events"]] == [
        intent["intent_id"] for intent in payload["command_intents"]
    ]


def test_step_can_rebootstrap_statelessly(client: TestClient, snapshot: dict) -> None:
    response = client.post(
        "/worlds/new-world/step",
        json={"steps": 1, "speed": 15, "seed": 42, "snapshot": snapshot},
    )
    assert response.status_code == 200, response.text
    assert response.json()["world_id"] == "new-world"


def test_missing_world_requires_snapshot_and_seed(client: TestClient) -> None:
    response = client.post("/worlds/missing/step", json={"steps": 1, "speed": 1})
    assert response.status_code == 404


def test_goal_plan_is_deterministic_and_intent_only(
    client: TestClient, snapshot: dict
) -> None:
    bootstrap(client, snapshot, world_id="goal-world")
    request = {
        "agent_id": "user-buyer",
        "goal": "audio headphones under budget",
        "budget": 10_000,
        "interests": ["audio"],
        "max_candidates": 3,
        "allow_offer": True,
    }
    first = client.post("/worlds/goal-world/agent-goal", json=request)
    second = client.post("/worlds/goal-world/agent-goal", json=request)
    assert first.status_code == 200, first.text
    assert first.json() == second.json()
    payload = first.json()
    assert payload["candidates"][0]["listing_id"] == "listing-audio"
    assert {intent["command"] for intent in payload["command_intents"]} <= {
        "browse",
        "offer",
    }


def test_cors_defaults_to_localhost(client: TestClient) -> None:
    allowed = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
