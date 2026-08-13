"""FastAPI transport for the Mesa marketplace simulation sidecar."""

from __future__ import annotations

import os
import threading
from typing import Annotated
from uuid import uuid4

import mesa
from fastapi import FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware

from .model import ENGINE_NAME, MarketplaceModel
from .schemas import (
    AgentGoalRequest,
    AgentGoalResponse,
    BootstrapRequest,
    HealthResponse,
    MarketplaceSnapshot,
    StepRequest,
    StepResponse,
    WorldSummary,
)


def _cors_origins() -> list[str]:
    configured = os.getenv("FURIMA_SIM_CORS_ORIGINS", "")
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app = FastAPI(
    title="Furima Simulation Sidecar",
    version="0.1.0",
    description=(
        "Deterministic Mesa simulations that return command intents; "
        "the web application remains the authoritative state owner."
    ),
)

origins = _cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=(
        None if origins else r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ModelRegistry:
    """Thread-safe local registry; production callers may re-bootstrap freely."""

    def __init__(self) -> None:
        self._models: dict[str, MarketplaceModel] = {}
        self._lock = threading.RLock()

    def put(self, model: MarketplaceModel) -> MarketplaceModel:
        with self._lock:
            self._models[model.world_id] = model
            return model

    def get(self, world_id: str) -> MarketplaceModel | None:
        with self._lock:
            return self._models.get(world_id)

    def clear(self) -> None:
        with self._lock:
            self._models.clear()


registry = ModelRegistry()


def _new_model(
    *, world_id: str, seed: int, snapshot: MarketplaceSnapshot
) -> MarketplaceModel:
    try:
        return MarketplaceModel(snapshot, world_id=world_id, rng=seed)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok", mesa_version=mesa.__version__, engine=ENGINE_NAME
    )


@app.post("/worlds/bootstrap", response_model=WorldSummary)
def bootstrap_world(request: BootstrapRequest) -> WorldSummary:
    world_id = request.world_id or f"world-{uuid4().hex}"
    model = _new_model(
        snapshot=request.snapshot,
        world_id=world_id,
        seed=request.seed,
    )
    registry.put(model)
    return model.summary()


WorldId = Annotated[
    str,
    Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"),
]


@app.post("/worlds/{world_id}/step", response_model=StepResponse)
def step_world(world_id: WorldId, request: StepRequest) -> StepResponse:
    model = registry.get(world_id)
    if model is None:
        if request.snapshot is None or request.seed is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "world is not in this process; include snapshot and seed "
                    "to re-bootstrap statelessly"
                ),
            )
        model = _new_model(
            snapshot=request.snapshot,
            world_id=world_id,
            seed=request.seed,
        )
        registry.put(model)
    elif request.seed is not None and request.seed != model.seed:
        if request.snapshot is None:
            raise HTTPException(
                status_code=409,
                detail="seed differs from the registered world; include a snapshot to replace it",
            )
        model = _new_model(
            snapshot=request.snapshot,
            world_id=world_id,
            seed=request.seed,
        )
        registry.put(model)

    intents, events, metrics = model.run_steps(
        steps=request.steps,
        speed=request.speed,
        snapshot=request.snapshot,
    )
    return StepResponse(
        world_id=world_id,
        seed=model.seed,
        steps=request.steps,
        speed=request.speed,
        command_intents=intents,
        events=events,
        metrics=metrics,
    )


@app.post(
    "/worlds/{world_id}/agent-goal",
    response_model=AgentGoalResponse,
)
def agent_goal(world_id: WorldId, request: AgentGoalRequest) -> AgentGoalResponse:
    model = registry.get(world_id)
    if model is None:
        raise HTTPException(
            status_code=404,
            detail="world is not in this process; bootstrap the world first",
        )
    try:
        agent_id, candidates, intents = model.build_goal_plan(request)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail="participant agent not found"
        ) from exc
    return AgentGoalResponse(
        world_id=world_id,
        agent_id=agent_id,
        goal=request.goal,
        candidates=candidates,
        command_intents=intents,
    )
