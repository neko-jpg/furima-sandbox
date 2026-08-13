"""Deterministic Mesa model that emits marketplace command intents only."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import threading
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import mesa

from .schemas import (
    ActorType,
    AgentGoalRequest,
    AgentMetric,
    CommandIntent,
    CommandName,
    GoalCandidate,
    ListingState,
    MarketplaceSnapshot,
    MetricsSnapshot,
    SimulationEvent,
    UserState,
    WorldSummary,
)

ENGINE_NAME = "mesa-3.5.1-agentset"
VIRTUAL_EPOCH = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
DEFAULT_ACTIVITY_HOURS = (7, 8, 12, 13, 18, 19, 20, 21, 22, 23)
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9ぁ-んァ-ヶ一-龥ー]+", re.UNICODE)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(*parts: Any, length: int = 24) -> str:
    serialized = "\x1f".join(
        part if isinstance(part, str) else _canonical_json(part) for part in parts
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:length]


def _stable_fraction(value: str) -> float:
    return int(_digest(value, length=12), 16) / float(16**12 - 1)


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


class ParticipantAgent(mesa.Agent):
    """A market participant with a deterministic behavioral persona."""

    def __init__(
        self, model: MarketplaceModel, user: UserState, *, is_human: bool
    ) -> None:
        super().__init__(model)
        self.participant_id = user.id
        self.display_name = user.display_name
        # The active browser participant is observational in Mesa. Every other
        # snapshot participant is an NPC, irrespective of UI fixture metadata.
        self.actor_type: ActorType = "human" if is_human else "npc"
        self.interests = tuple(
            dict.fromkeys(user.interests + user.preferred_categories)
        ) or ("その他",)
        self.initial_budget = user.budget or max(
            30_000, user.sales_balance + user.points
        )
        self.wealth = max(
            0,
            self.initial_budget
            - model.committed_spend(user.id)
            - model.planned_spend(user.id),
        )
        self.price_sensitivity = (
            user.price_sensitivity
            if user.price_sensitivity is not None
            else 0.55 + 0.35 * _stable_fraction(f"{user.id}:price")
        )
        self.negotiation_tendency = (
            user.negotiation_tendency
            if user.negotiation_tendency is not None
            else 0.2 + 0.6 * _stable_fraction(f"{user.id}:negotiation")
        )
        self.impulsiveness = (
            user.impulsiveness
            if user.impulsiveness is not None
            else 0.15 + 0.7 * _stable_fraction(f"{user.id}:impulsiveness")
        )
        self.activity_hours = tuple(user.activity_hours or DEFAULT_ACTIVITY_HOURS)
        self.activity_count = 0

    def refresh(self, user: UserState, *, is_human: bool) -> None:
        """Refresh descriptive fields without discarding simulated history."""

        self.display_name = user.display_name
        self.actor_type = "human" if is_human else "npc"
        self.initial_budget = user.budget or max(
            30_000, user.sales_balance + user.points
        )
        self.wealth = max(
            0,
            self.initial_budget
            - self.model.committed_spend(user.id)
            - self.model.planned_spend(user.id),
        )
        if user.price_sensitivity is not None:
            self.price_sensitivity = user.price_sensitivity
        if user.negotiation_tendency is not None:
            self.negotiation_tendency = user.negotiation_tendency
        if user.impulsiveness is not None:
            self.impulsiveness = user.impulsiveness
        interests = tuple(dict.fromkeys(user.interests + user.preferred_categories))
        if interests:
            self.interests = interests
        self.activity_hours = tuple(user.activity_hours or self.activity_hours)

    def step(self) -> None:
        if not self.model.is_agent_active(self):
            return

        self.activity_count += 1
        if self.model.emit_transaction_progress(self):
            return

        listing = self.model.select_listing(self)
        if listing is None:
            return

        title = self.model.listing_title(listing)
        self.model.emit_intent(
            self,
            "browse",
            "LISTING",
            listing.id,
            {
                "listingId": listing.id,
                "title": title,
                "category": listing.category_id,
            },
        )
        self.model.browse_intents += 1

        category_interest = self.model.interest_score(self, listing)
        price_ratio = listing.price / max(1, self.wealth)
        like_probability = _clamp(
            0.08
            + 0.35 * category_interest
            + 0.25 * self.impulsiveness
            + 0.12 * (1 - min(1.0, price_ratio))
        )
        like_key = (self.participant_id, listing.id)
        if (
            like_key not in self.model.effective_likes
            and float(self.model.rng.random()) < like_probability
        ):
            self.model.emit_intent(
                self,
                "like",
                "LISTING",
                listing.id,
                {"listingId": listing.id, "liked": True},
            )
            self.model.planned_likes.add(like_key)

        if listing.price <= self.wealth:
            buy_probability = _clamp(
                0.05
                + 0.42 * self.impulsiveness
                + 0.22 * category_interest
                - 0.22 * self.price_sensitivity * min(1.0, price_ratio)
            )
            if float(self.model.rng.random()) < buy_probability:
                self.model.emit_intent(
                    self,
                    "buy",
                    "LISTING",
                    listing.id,
                    {
                        "listingId": listing.id,
                        "expectedListingVersion": listing.version,
                        "maxTotal": listing.price,
                    },
                )
                self.model.planned_purchases[listing.id] = (
                    self.participant_id,
                    listing.price,
                )
                self.model.reserved_listing_ids.add(listing.id)
                self.wealth = max(0, self.wealth - listing.price)
                return

        offer_key = (self.participant_id, listing.id)
        if (
            listing.price > 300
            and offer_key not in self.model.offered_pairs
            and float(self.model.rng.random()) < self.negotiation_tendency
        ):
            discount = 0.03 + 0.16 * self.negotiation_tendency
            discount += 0.08 * self.price_sensitivity
            offered = int(math.floor(listing.price * (1 - discount) / 100) * 100)
            offered = max(300, min(listing.price - 100, offered, self.wealth))
            if 300 <= offered < listing.price:
                self.model.emit_intent(
                    self,
                    "offer",
                    "LISTING",
                    listing.id,
                    {
                        "listingId": listing.id,
                        "amount": offered,
                        "expiresInMinutes": 1_440,
                    },
                )
                self.model.offered_pairs.add(offer_key)


class MarketplaceModel(mesa.Model):
    """Shared-market Mesa model with no persistence or spatial grid.

    ``rng`` is intentionally forwarded to Mesa's current random-generator API.
    The deprecated ``seed`` constructor argument is not exposed.
    """

    def __init__(
        self,
        snapshot: MarketplaceSnapshot | Mapping[str, Any],
        *,
        world_id: str = "world-local",
        rng: int = 0,
    ) -> None:
        super().__init__(rng=rng)
        self.world_id = world_id
        self.seed = rng
        self._lock = threading.RLock()
        self.tick_index = 0
        self.elapsed_minutes = 0
        self.minutes_per_step = 1
        self.intent_sequence = 0
        self.browse_intents = 0
        self._response_intents: list[CommandIntent] = []
        self._response_events: list[SimulationEvent] = []
        self.planned_likes: set[tuple[str, str]] = set()
        self.planned_purchases: dict[str, tuple[str, int]] = {}
        self.reserved_listing_ids: set[str] = set()
        self.offered_pairs: set[tuple[str, str]] = set()
        self._issued_state_commands: set[str] = set()
        self._snapshot_fingerprint = ""
        self.snapshot = self._copy_snapshot(snapshot)
        self._index_snapshot()
        self._build_agents(self.snapshot.users)
        if not self.agents:
            raise ValueError("a world requires at least one participant user")

        self.datacollector = mesa.DataCollector(
            model_reporters={
                "gmv": lambda model: model.gmv,
                "listings": lambda model: model.active_listing_count,
                "transactions": lambda model: model.transaction_count,
                "conversion": lambda model: model.conversion,
                "likes": lambda model: model.like_count,
                "model_time": lambda model: float(model.elapsed_minutes),
                "browse_intents": lambda model: model.browse_intents,
            },
            agent_reporters={
                "wealth": "wealth",
                "activity": "activity_count",
                "actor_id": "participant_id",
            },
        )
        self.datacollector.collect(self)

    @staticmethod
    def _copy_snapshot(
        snapshot: MarketplaceSnapshot | Mapping[str, Any],
    ) -> MarketplaceSnapshot:
        if isinstance(snapshot, MarketplaceSnapshot):
            return snapshot.model_copy(deep=True)
        return MarketplaceSnapshot.model_validate(copy.deepcopy(dict(snapshot)))

    def _build_agents(self, users: list[UserState]) -> None:
        for user in sorted(users, key=lambda value: value.id):
            ParticipantAgent(
                self,
                user,
                is_human=user.id == self.snapshot.current_user_id,
            )

    def _index_snapshot(self) -> None:
        dumped = self.snapshot.model_dump(mode="json")
        new_fingerprint = _digest(dumped, length=32)
        if self._snapshot_fingerprint and self._snapshot_fingerprint != new_fingerprint:
            self.planned_likes.clear()
            self.planned_purchases.clear()
            self.offered_pairs.clear()
        self._snapshot_fingerprint = new_fingerprint
        self.items_by_id = {item.id: item for item in self.snapshot.items}
        self.listings_by_id = {
            listing.id: listing for listing in self.snapshot.listings
        }
        self.transactions_by_id = {
            transaction.id: transaction for transaction in self.snapshot.transactions
        }
        self.observed_likes = {
            (like.user_id, like.listing_id) for like in self.snapshot.likes
        }
        observed_reservations = {
            transaction.listing_id
            for transaction in self.snapshot.transactions
            if transaction.transaction_status.upper() not in {"CANCELED", "COMPLETED"}
        }
        self.reserved_listing_ids = observed_reservations | set(self.planned_purchases)

    def reconcile_snapshot(
        self, snapshot: MarketplaceSnapshot | Mapping[str, Any]
    ) -> None:
        """Replace authoritative observations without mutating caller data."""

        with self._lock:
            next_snapshot = self._copy_snapshot(snapshot)
            previous_ids = {
                agent.participant_id
                for agent in self.agents
                if isinstance(agent, ParticipantAgent)
            }
            next_ids = {user.id for user in next_snapshot.users}
            self.snapshot = next_snapshot
            self._index_snapshot()
            if previous_ids != next_ids:
                self.remove_all_agents()
                self._build_agents(next_snapshot.users)
            else:
                by_id = {
                    agent.participant_id: agent
                    for agent in self.agents
                    if isinstance(agent, ParticipantAgent)
                }
                for user in next_snapshot.users:
                    by_id[user.id].refresh(
                        user,
                        is_human=user.id == next_snapshot.current_user_id,
                    )

    @property
    def effective_likes(self) -> set[tuple[str, str]]:
        return self.observed_likes | self.planned_likes

    @property
    def gmv(self) -> int:
        observed_gmv = sum(
            transaction.total or transaction.item_price
            for transaction in self.snapshot.transactions
            if transaction.transaction_status.upper() != "CANCELED"
        )
        return observed_gmv + sum(price for _, price in self.planned_purchases.values())

    @property
    def active_listing_count(self) -> int:
        return sum(
            1
            for listing in self.snapshot.listings
            if listing.status.upper() == "PUBLISHED"
            and listing.availability.upper() == "AVAILABLE"
            and listing.id not in self.reserved_listing_ids
        )

    @property
    def transaction_count(self) -> int:
        observed = sum(
            1
            for transaction in self.snapshot.transactions
            if transaction.transaction_status.upper() != "CANCELED"
        )
        return observed + len(self.planned_purchases)

    @property
    def conversion(self) -> float:
        transaction_count = len(self.snapshot.transactions)
        opportunities = transaction_count + self.browse_intents
        if opportunities == 0:
            return 0.0
        return _clamp(transaction_count / opportunities)

    @property
    def like_count(self) -> int:
        return len(self.effective_likes)

    def committed_spend(self, buyer_id: str) -> int:
        return sum(
            transaction.total or transaction.item_price
            for transaction in self.snapshot.transactions
            if transaction.buyer_id == buyer_id
            and transaction.transaction_status.upper() != "CANCELED"
        )

    def planned_spend(self, buyer_id: str) -> int:
        return sum(
            price
            for participant_id, price in self.planned_purchases.values()
            if participant_id == buyer_id
        )

    @property
    def simulated_at(self) -> datetime:
        return VIRTUAL_EPOCH + timedelta(minutes=self.elapsed_minutes)

    def listing_title(self, listing: ListingState) -> str:
        if listing.title:
            return listing.title
        if listing.item_id and listing.item_id in self.items_by_id:
            return self.items_by_id[listing.item_id].title
        return listing.id

    def listing_description(self, listing: ListingState) -> str:
        if listing.description:
            return listing.description
        if listing.item_id and listing.item_id in self.items_by_id:
            return self.items_by_id[listing.item_id].description
        return ""

    def is_agent_active(self, agent: ParticipantAgent) -> bool:
        hour = self.simulated_at.hour
        return hour in agent.activity_hours

    def available_listings(self, agent_id: str) -> list[ListingState]:
        return [
            listing
            for listing in self.snapshot.listings
            if listing.seller_id != agent_id
            and listing.status.upper() == "PUBLISHED"
            and listing.availability.upper() == "AVAILABLE"
            and listing.sale_type.upper() == "FIXED_PRICE"
            and listing.id not in self.reserved_listing_ids
        ]

    def interest_score(self, agent: ParticipantAgent, listing: ListingState) -> float:
        text = " ".join(
            (
                listing.category_id,
                self.listing_title(listing),
                self.listing_description(listing),
            )
        ).lower()
        matches = sum(1 for interest in agent.interests if interest.lower() in text)
        return _clamp(matches / max(1, len(agent.interests)))

    def select_listing(self, agent: ParticipantAgent) -> ListingState | None:
        candidates = self.available_listings(agent.participant_id)
        if not candidates:
            return None
        ranked = sorted(
            candidates,
            key=lambda listing: (
                -self.interest_score(agent, listing),
                listing.price > agent.wealth,
                listing.price,
                listing.id,
            ),
        )
        pool = ranked[: min(3, len(ranked))]
        return pool[int(self.rng.integers(0, len(pool)))]

    def emit_transaction_progress(self, agent: ParticipantAgent) -> bool:
        for transaction in sorted(
            self.snapshot.transactions, key=lambda value: value.id
        ):
            command: CommandName | None = None
            payload: dict[str, Any] = {"transactionId": transaction.id}
            fulfillment = transaction.fulfillment_status.upper()
            payment = transaction.payment_status.upper()
            transaction_status = transaction.transaction_status.upper()
            buyer_rating = transaction.buyer_rating_status.upper()
            seller_rating = transaction.seller_rating_status.upper()

            if transaction_status != "ACTIVE":
                continue
            if (
                agent.participant_id == transaction.seller_id
                and payment == "PAID"
                and fulfillment == "AWAITING_SHIPMENT"
            ):
                command = "ship"
            elif agent.participant_id == transaction.buyer_id and fulfillment in {
                "SHIPPED",
                "IN_TRANSIT",
                "OUT_FOR_DELIVERY",
            }:
                command = "deliver"
                payload["status"] = "DELIVERED"
            elif (
                agent.participant_id == transaction.buyer_id
                and fulfillment == "DELIVERED"
                and buyer_rating == "PENDING"
            ):
                command = "review"
                payload.update({"rating": 5, "comment": "受け取りました"})
            elif (
                agent.participant_id == transaction.seller_id
                and fulfillment == "DELIVERED"
                and buyer_rating == "COMPLETED"
                and seller_rating == "PENDING"
            ):
                command = "review"
                payload.update({"rating": 5, "comment": "ありがとうございました"})

            if command is None:
                continue
            state_key = _digest(
                agent.participant_id,
                command,
                transaction.id,
                transaction_status,
                payment,
                fulfillment,
                buyer_rating,
                seller_rating,
            )
            if state_key in self._issued_state_commands:
                continue
            self._issued_state_commands.add(state_key)
            self.emit_intent(
                agent,
                command,
                "TRANSACTION",
                transaction.id,
                payload,
            )
            return True
        return False

    def emit_intent(
        self,
        agent: ParticipantAgent,
        command: CommandName,
        target_type: str,
        target_id: str,
        payload: dict[str, Any],
    ) -> CommandIntent:
        self.intent_sequence += 1
        sequence = self.intent_sequence
        intent_id = f"{self.world_id}:intent:{sequence:08d}"
        semantic_key = (
            (self.seed, self._snapshot_fingerprint, sequence)
            if command == "browse"
            else ()
        )
        idempotency_key = _digest(
            self.world_id,
            *semantic_key,
            agent.participant_id,
            command,
            target_id,
            payload,
        )
        intent = CommandIntent(
            intent_id=intent_id,
            idempotency_key=idempotency_key,
            sequence=sequence,
            world_id=self.world_id,
            actor_id=agent.participant_id,
            actor_type=agent.actor_type,
            command=command,
            target_type=target_type,
            target_id=target_id,
            payload=payload,
            simulated_at=self.simulated_at,
        )
        event = SimulationEvent(
            event_id=f"{self.world_id}:event:{sequence:08d}",
            sequence=sequence,
            event_type=f"intent.{command}",
            world_id=self.world_id,
            actor_id=agent.participant_id,
            actor_type=agent.actor_type,
            target_id=target_id,
            caused_by=intent_id,
            simulated_at=self.simulated_at,
            metadata={"command": command, "payload": payload},
        )
        self._response_intents.append(intent)
        self._response_events.append(event)
        return intent

    def step(self) -> None:
        self.tick_index += 1
        self.elapsed_minutes += self.minutes_per_step
        # Human participants are present for metrics and explicit agent-goal
        # planning, but are never activated by the autonomous simulation.
        self.agents.select(
            lambda agent: (
                isinstance(agent, ParticipantAgent) and agent.actor_type == "npc"
            )
        ).shuffle_do("step")
        self.datacollector.collect(self)

    def run_steps(
        self,
        *,
        steps: int,
        speed: int,
        snapshot: MarketplaceSnapshot | Mapping[str, Any] | None = None,
    ) -> tuple[list[CommandIntent], list[SimulationEvent], MetricsSnapshot]:
        with self._lock:
            if snapshot is not None:
                self.reconcile_snapshot(snapshot)
            self.minutes_per_step = speed
            self._response_intents = []
            self._response_events = []
            for _ in range(steps):
                self.step()
            return (
                list(self._response_intents),
                list(self._response_events),
                self.latest_metrics(),
            )

    def latest_metrics(self) -> MetricsSnapshot:
        model_vars = self.datacollector.model_vars
        agents = sorted(
            (
                AgentMetric(
                    actor_id=agent.participant_id,
                    wealth=agent.wealth,
                    activity=agent.activity_count,
                )
                for agent in self.agents
                if isinstance(agent, ParticipantAgent)
            ),
            key=lambda metric: metric.actor_id,
        )
        return MetricsSnapshot(
            gmv=int(model_vars["gmv"][-1]),
            listings=int(model_vars["listings"][-1]),
            transactions=int(model_vars["transactions"][-1]),
            conversion=float(model_vars["conversion"][-1]),
            likes=int(model_vars["likes"][-1]),
            model_time=float(model_vars["model_time"][-1]),
            browse_intents=int(model_vars["browse_intents"][-1]),
            agents=agents,
        )

    def summary(self) -> WorldSummary:
        return WorldSummary(
            world_id=self.world_id,
            seed=self.seed,
            engine=ENGINE_NAME,
            participants=len(self.agents),
            active_listings=self.active_listing_count,
            transactions=len(self.snapshot.transactions),
            metrics=self.latest_metrics(),
        )

    def _goal_score(
        self,
        listing: ListingState,
        *,
        goal_tokens: set[str],
        interests: tuple[str, ...],
        budget: int,
    ) -> tuple[float, list[str]]:
        text = " ".join(
            (
                self.listing_title(listing),
                self.listing_description(listing),
                listing.category_id,
            )
        ).lower()
        token_matches = sum(1 for token in goal_tokens if token in text)
        interest_matches = sum(1 for interest in interests if interest.lower() in text)
        text_score = token_matches / max(1, len(goal_tokens))
        interest_score = interest_matches / max(1, len(interests))
        affordability = (
            1.0
            if listing.price <= budget
            else max(0.0, 1 - (listing.price - budget) / max(1, budget))
        )
        popularity = min(1.0, listing.likes_count / 100)
        score = _clamp(
            0.42 * text_score
            + 0.24 * interest_score
            + 0.29 * affordability
            + 0.05 * popularity
        )
        reasons: list[str] = []
        if token_matches:
            reasons.append("goal_match")
        if interest_matches:
            reasons.append("interest_match")
        reasons.append(
            "within_budget" if listing.price <= budget else "offer_candidate"
        )
        return score, reasons

    def build_goal_plan(
        self, request: AgentGoalRequest
    ) -> tuple[str, list[GoalCandidate], list[CommandIntent]]:
        with self._lock:
            participants = sorted(
                (agent for agent in self.agents if isinstance(agent, ParticipantAgent)),
                key=lambda agent: agent.participant_id,
            )
            agent = next(
                (
                    candidate
                    for candidate in participants
                    if candidate.participant_id == request.agent_id
                ),
                participants[0] if participants and request.agent_id is None else None,
            )
            if agent is None:
                raise KeyError(request.agent_id or "")

            budget = request.budget or agent.wealth
            interests = tuple(request.interests) or agent.interests
            goal_tokens = {
                token.lower() for token in TOKEN_PATTERN.findall(request.goal)
            }
            ranked: list[tuple[float, ListingState, list[str]]] = []
            for listing in self.available_listings(agent.participant_id):
                if listing.price > budget * 1.5:
                    continue
                score, reasons = self._goal_score(
                    listing,
                    goal_tokens=goal_tokens,
                    interests=interests,
                    budget=budget,
                )
                ranked.append((score, listing, reasons))
            ranked.sort(key=lambda row: (-row[0], row[1].price, row[1].id))
            ranked = ranked[: request.max_candidates]
            candidates = [
                GoalCandidate(
                    listing_id=listing.id,
                    title=self.listing_title(listing),
                    category=listing.category_id,
                    price=listing.price,
                    score=round(score, 6),
                    reasons=reasons,
                )
                for score, listing, reasons in ranked
            ]

            intents: list[CommandIntent] = []
            for local_sequence, (_, listing, _) in enumerate(ranked, start=1):
                intents.append(
                    self._goal_intent(
                        agent=agent,
                        request=request,
                        local_sequence=local_sequence,
                        command="browse",
                        listing=listing,
                        payload={
                            "listingId": listing.id,
                            "goal": request.goal,
                            "source": "agent_goal",
                        },
                    )
                )
            if ranked and request.allow_offer:
                _, top_listing, _ = ranked[0]
                discount = 0.04 + 0.14 * agent.negotiation_tendency
                offer = int(math.floor(top_listing.price * (1 - discount) / 100) * 100)
                offer = max(300, min(top_listing.price - 100, offer, budget))
                if 300 <= offer < top_listing.price:
                    intents.append(
                        self._goal_intent(
                            agent=agent,
                            request=request,
                            local_sequence=len(intents) + 1,
                            command="offer",
                            listing=top_listing,
                            payload={
                                "listingId": top_listing.id,
                                "amount": offer,
                                "goal": request.goal,
                                "source": "agent_goal",
                            },
                        )
                    )
            return agent.participant_id, candidates, intents

    def _goal_intent(
        self,
        *,
        agent: ParticipantAgent,
        request: AgentGoalRequest,
        local_sequence: int,
        command: CommandName,
        listing: ListingState,
        payload: dict[str, Any],
    ) -> CommandIntent:
        content_hash = _digest(
            self.world_id,
            self._snapshot_fingerprint,
            agent.participant_id,
            request.model_dump(mode="json"),
            command,
            listing.id,
            payload,
        )
        return CommandIntent(
            intent_id=f"{self.world_id}:goal:{content_hash}",
            idempotency_key=content_hash,
            sequence=local_sequence,
            world_id=self.world_id,
            actor_id=agent.participant_id,
            actor_type=agent.actor_type,
            command=command,
            target_type="LISTING",
            target_id=listing.id,
            payload=payload,
            simulated_at=self.simulated_at,
        )
