"""Validated transport and snapshot schemas for the simulation sidecar."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    field_validator,
    model_validator,
)

CommandName = Literal["browse", "like", "offer", "buy", "ship", "deliver", "review"]
ActorType = Literal["human", "npc", "ai_agent", "operator", "system"]


class SnapshotModel(BaseModel):
    """Base class that tolerates fields owned by the TypeScript application."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class UserState(SnapshotModel):
    id: str
    display_name: str = Field(
        default="Participant",
        validation_alias=AliasChoices("display_name", "displayName", "name"),
    )
    sales_balance: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("sales_balance", "salesBalance"),
    )
    points: int = Field(default=0, ge=0)
    budget: int | None = Field(default=None, ge=0)
    interests: list[str] = Field(default_factory=list)
    preferred_categories: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("preferred_categories", "preferredCategories"),
    )
    price_sensitivity: float | None = Field(
        default=None,
        ge=0,
        le=1,
        validation_alias=AliasChoices("price_sensitivity", "priceSensitivity"),
    )
    negotiation_tendency: float | None = Field(
        default=None,
        ge=0,
        le=1,
        validation_alias=AliasChoices("negotiation_tendency", "negotiationTendency"),
    )
    impulsiveness: float | None = Field(default=None, ge=0, le=1)
    activity_hours: list[int] = Field(
        default_factory=list,
        validation_alias=AliasChoices("activity_hours", "activityHours"),
    )
    actor_type: str = Field(
        default="npc",
        validation_alias=AliasChoices("actor_type", "actorType"),
    )

    @model_validator(mode="before")
    @classmethod
    def merge_persona(cls, value: Any) -> Any:
        if not isinstance(value, Mapping):
            return value
        merged = dict(value)
        persona = merged.get("persona")
        if isinstance(persona, Mapping):
            for key, persona_value in persona.items():
                merged.setdefault(key, persona_value)
        return merged

    @field_validator("activity_hours")
    @classmethod
    def validate_activity_hours(cls, value: list[int]) -> list[int]:
        if any(hour < 0 or hour > 23 for hour in value):
            raise ValueError("activity hours must be between 0 and 23")
        return sorted(set(value))


class ItemState(SnapshotModel):
    id: str
    title: str = ""
    description: str = ""


class ListingState(SnapshotModel):
    id: str
    item_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("item_id", "itemId"),
    )
    seller_id: str = Field(validation_alias=AliasChoices("seller_id", "sellerId"))
    category_id: str = Field(
        default="その他",
        validation_alias=AliasChoices("category_id", "categoryId", "category"),
    )
    title: str = ""
    description: str = ""
    price: int = Field(ge=0)
    status: str = "PUBLISHED"
    availability: str = "AVAILABLE"
    sale_type: str = Field(
        default="FIXED_PRICE",
        validation_alias=AliasChoices("sale_type", "saleType"),
    )
    version: int = Field(default=1, ge=0)
    likes_count: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("likes_count", "likesCount"),
    )


class TransactionState(SnapshotModel):
    id: str
    listing_id: str = Field(validation_alias=AliasChoices("listing_id", "listingId"))
    seller_id: str = Field(validation_alias=AliasChoices("seller_id", "sellerId"))
    buyer_id: str = Field(validation_alias=AliasChoices("buyer_id", "buyerId"))
    transaction_status: str = Field(
        default="ACTIVE",
        validation_alias=AliasChoices("transaction_status", "transactionStatus"),
    )
    payment_status: str = Field(
        default="PAID",
        validation_alias=AliasChoices("payment_status", "paymentStatus"),
    )
    fulfillment_status: str = Field(
        default="AWAITING_SHIPMENT",
        validation_alias=AliasChoices("fulfillment_status", "fulfillmentStatus"),
    )
    buyer_rating_status: str = Field(
        default="PENDING",
        validation_alias=AliasChoices("buyer_rating_status", "buyerRatingStatus"),
    )
    seller_rating_status: str = Field(
        default="PENDING",
        validation_alias=AliasChoices("seller_rating_status", "sellerRatingStatus"),
    )
    item_price: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("item_price", "itemPrice"),
    )
    total: int = Field(default=0, ge=0)


class LikeState(SnapshotModel):
    user_id: str = Field(validation_alias=AliasChoices("user_id", "userId"))
    listing_id: str = Field(validation_alias=AliasChoices("listing_id", "listingId"))


class MarketplaceSnapshot(SnapshotModel):
    """Subset of the web application's marketplace export used by Mesa."""

    state_version: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("state_version", "stateVersion"),
    )
    current_user_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("current_user_id", "currentUserId"),
    )
    users: list[UserState] = Field(default_factory=list)
    items: list[ItemState] = Field(default_factory=list)
    listings: list[ListingState] = Field(default_factory=list)
    transactions: list[TransactionState] = Field(default_factory=list)
    likes: list[LikeState] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def unwrap_world_export(cls, value: Any) -> Any:
        if isinstance(value, Mapping) and isinstance(value.get("marketplace"), Mapping):
            return dict(value["marketplace"])
        return value


class CommandIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent_id: str
    idempotency_key: str
    sequence: int = Field(ge=1)
    world_id: str
    actor_id: str
    actor_type: ActorType
    command: CommandName
    target_type: str
    target_id: str
    payload: dict[str, JsonValue] = Field(default_factory=dict)
    simulated_at: datetime


class SimulationEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    sequence: int = Field(ge=1)
    event_type: str
    world_id: str
    actor_id: str
    actor_type: ActorType
    target_id: str
    caused_by: str
    simulated_at: datetime
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentMetric(BaseModel):
    actor_id: str
    wealth: int = Field(ge=0)
    activity: int = Field(ge=0)


class MetricsSnapshot(BaseModel):
    gmv: int = Field(ge=0)
    listings: int = Field(ge=0)
    transactions: int = Field(ge=0)
    conversion: float = Field(ge=0, le=1)
    likes: int = Field(ge=0)
    model_time: float = Field(ge=0)
    browse_intents: int = Field(ge=0)
    agents: list[AgentMetric] = Field(default_factory=list)


class BootstrapRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    world_id: Annotated[
        str | None,
        Field(
            min_length=1,
            max_length=128,
            pattern=r"^[A-Za-z0-9._:-]+$",
        ),
    ] = None
    seed: Annotated[int, Field(ge=0, le=2**63 - 1)] = 0
    snapshot: MarketplaceSnapshot

    @model_validator(mode="before")
    @classmethod
    def normalize_world_id(cls, value: Any) -> Any:
        if (
            isinstance(value, Mapping)
            and "world_id" not in value
            and "worldId" in value
        ):
            return {**value, "world_id": value["worldId"]}
        return value


class WorldSummary(BaseModel):
    world_id: str
    seed: int
    engine: str
    participants: int = Field(ge=0)
    active_listings: int = Field(ge=0)
    transactions: int = Field(ge=0)
    metrics: MetricsSnapshot


class StepRequest(BaseModel):
    steps: Annotated[int, Field(ge=1, le=1_000)] = 1
    speed: Annotated[int, Field(ge=1, le=1_000)] = 1
    snapshot: MarketplaceSnapshot | None = None
    seed: Annotated[int | None, Field(ge=0, le=2**63 - 1)] = None


class StepResponse(BaseModel):
    world_id: str
    seed: int
    steps: int
    speed: int
    command_intents: list[CommandIntent]
    events: list[SimulationEvent]
    metrics: MetricsSnapshot


class GoalCandidate(BaseModel):
    listing_id: str
    title: str
    category: str
    price: int = Field(ge=0)
    score: float = Field(ge=0, le=1)
    reasons: list[str]


class AgentGoalRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_id: Annotated[
        str | None,
        Field(),
    ] = None
    goal: str = Field(min_length=1, max_length=500)
    budget: int | None = Field(default=None, ge=300)
    interests: list[str] = Field(default_factory=list)
    max_candidates: int = Field(default=3, ge=1, le=20)
    allow_offer: bool = True

    @model_validator(mode="before")
    @classmethod
    def normalize_agent_id(cls, value: Any) -> Any:
        if (
            isinstance(value, Mapping)
            and "agent_id" not in value
            and "agentId" in value
        ):
            return {**value, "agent_id": value["agentId"]}
        return value


class AgentGoalResponse(BaseModel):
    world_id: str
    agent_id: str
    goal: str
    candidates: list[GoalCandidate]
    command_intents: list[CommandIntent]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    mesa_version: str
    engine: str
