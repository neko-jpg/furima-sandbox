from __future__ import annotations

import copy

from furima_sim.model import MarketplaceModel
from furima_sim.schemas import CommandIntent


def serialize_run(snapshot: dict, *, seed: int = 42) -> dict:
    model = MarketplaceModel(snapshot, world_id="world-deterministic", rng=seed)
    intents, events, metrics = model.run_steps(steps=8, speed=60)
    return {
        "intents": [intent.model_dump(mode="json") for intent in intents],
        "events": [event.model_dump(mode="json") for event in events],
        "metrics": metrics.model_dump(mode="json"),
    }


def test_seed_determinism(snapshot: dict) -> None:
    assert serialize_run(snapshot, seed=12345) == serialize_run(snapshot, seed=12345)


def test_different_seed_changes_activation_or_decisions(snapshot: dict) -> None:
    first = serialize_run(snapshot, seed=101)
    second = serialize_run(snapshot, seed=202)
    assert first["intents"] != second["intents"]


def test_same_state_same_intents(snapshot: dict) -> None:
    first = MarketplaceModel(snapshot, world_id="same-state", rng=9)
    second = MarketplaceModel(copy.deepcopy(snapshot), world_id="same-state", rng=9)
    first_intents, _, _ = first.run_steps(steps=4, speed=30)
    second_intents, _, _ = second.run_steps(steps=4, speed=30)
    assert [intent.model_dump() for intent in first_intents] == [
        intent.model_dump() for intent in second_intents
    ]


def test_model_never_mutates_input_snapshot(snapshot: dict) -> None:
    original = copy.deepcopy(snapshot)
    model = MarketplaceModel(snapshot, world_id="immutable", rng=77)
    model.run_steps(steps=12, speed=60)
    assert snapshot == original


def test_command_intents_are_validated_and_ordered(snapshot: dict) -> None:
    model = MarketplaceModel(snapshot, world_id="schema", rng=55)
    intents, events, _ = model.run_steps(steps=5, speed=60)
    assert intents
    assert [intent.sequence for intent in intents] == sorted(
        intent.sequence for intent in intents
    )
    assert {intent.command for intent in intents} <= {
        "browse",
        "like",
        "offer",
        "buy",
        "ship",
        "deliver",
        "review",
    }
    assert len({intent.idempotency_key for intent in intents}) == len(intents)
    assert all(
        CommandIntent.model_validate(intent.model_dump()).world_id == "schema"
        for intent in intents
    )
    assert [event.caused_by for event in events] == [
        intent.intent_id for intent in intents
    ]


def test_metrics_and_agent_data_are_collected(snapshot: dict) -> None:
    model = MarketplaceModel(snapshot, world_id="metrics", rng=5)
    _, _, metrics = model.run_steps(steps=3, speed=60)
    assert metrics.listings >= 0
    assert metrics.transactions >= 0
    assert 0 <= metrics.conversion <= 1
    assert metrics.likes >= len(snapshot["likes"])
    assert metrics.model_time == 180
    assert {metric.actor_id for metric in metrics.agents} == {
        user["id"] for user in snapshot["users"]
    }
    assert len(model.datacollector.model_vars["gmv"]) == 4


def test_projected_metrics_persist_across_step_batches(snapshot: dict) -> None:
    model = MarketplaceModel(snapshot, world_id="metrics-progress", rng=101)
    model.run_steps(steps=10, speed=60)
    first = model.latest_metrics()
    model.run_steps(steps=2, speed=60)
    second = model.latest_metrics()
    assert second.gmv >= first.gmv
    assert second.transactions >= first.transactions
    assert second.likes >= first.likes


def test_transaction_progress_emits_command_not_state_change(snapshot: dict) -> None:
    snapshot["transactions"] = [
        {
            "id": "transaction-1",
            "listingId": "listing-audio",
            "sellerId": "user-seller",
            "buyerId": "user-buyer",
            "transactionStatus": "ACTIVE",
            "paymentStatus": "PAID",
            "fulfillmentStatus": "AWAITING_SHIPMENT",
            "buyerRatingStatus": "PENDING",
            "sellerRatingStatus": "PENDING",
            "itemPrice": 9_800,
            "total": 9_800,
        }
    ]
    original = copy.deepcopy(snapshot)
    model = MarketplaceModel(snapshot, world_id="lifecycle", rng=1)
    intents, _, _ = model.run_steps(steps=1, speed=60)
    assert any(intent.command == "ship" for intent in intents)
    assert snapshot == original
    assert model.snapshot.transactions[0].fulfillment_status == "AWAITING_SHIPMENT"


def test_current_user_is_human_and_never_autonomously_activated(snapshot: dict) -> None:
    model = MarketplaceModel(snapshot, world_id="human-safety", rng=123)
    intents, _, metrics = model.run_steps(steps=20, speed=60)
    assert all(intent.actor_id != snapshot["currentUserId"] for intent in intents)
    human = next(
        agent
        for agent in model.agents
        if agent.participant_id == snapshot["currentUserId"]
    )
    npc = next(
        agent
        for agent in model.agents
        if agent.participant_id != snapshot["currentUserId"]
    )
    assert human.actor_type == "human"
    assert human.activity_count == 0
    assert npc.actor_type == "npc"
    human_metric = next(
        metric
        for metric in metrics.agents
        if metric.actor_id == snapshot["currentUserId"]
    )
    assert human_metric.activity == 0
