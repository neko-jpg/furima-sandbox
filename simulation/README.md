# Furima Simulation Sidecar

`furima_sim` is the Python/Mesa simulation boundary for Furima Sandbox. It
loads a JSON snapshot exported by the web application, runs deterministic
participant agents, and returns **command intents**. It never imports the web
application database and never writes marketplace state directly.

The boundary is deliberate:

```text
Web application snapshot -> Mesa MarketplaceModel -> ordered command intents
                                                  -> events and metrics
Command intents -> existing application command/domain layer -> database
```

Mesa owns simulated activation order and agent-local shadow state. The web
application remains authoritative for users, listings, transactions, wallets,
and event persistence. A later request can send the resulting application
snapshot back to the sidecar. The local API keeps models in memory, but a step
request containing a snapshot and seed can reconstruct a missing world.

## Runtime

- Python 3.12 or newer (verified with Python 3.14)
- Mesa 3.5.1, initialized with `rng=`
- FastAPI and Uvicorn
- Pydantic v2 transport contracts

No spatial grid is used: every participant observes one shared marketplace.
`AgentSet.shuffle_do("step")` supplies deterministic seeded activation.
`DataCollector` records GMV, active listings, transaction count, conversion,
likes, and per-agent wealth/activity after every tick.

The participant matching `snapshot.currentUserId` (or `current_user_id`) is
always classified as `human` and is excluded from autonomous activation. All
other snapshot participants are classified as `npc`; this prevents Mesa from
performing actions on behalf of the person currently using the web app.

## Install, run, and test

From this directory:

```powershell
uv sync --python 3.14
uv run pytest
uv run uvicorn furima_sim.api:app --host 127.0.0.1 --port 8010
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8010/health
```

Browser origins default to localhost and `127.0.0.1` on any HTTP port. Override
the comma-separated allow-list with `FURIMA_SIM_CORS_ORIGINS`.

## API

### `POST /worlds/bootstrap`

Accepts either the marketplace object itself or the complete value returned by
`window.__FURIMA_SANDBOX_API__.getWorldState()` as `snapshot`.

```json
{
  "world_id": "demo-world",
  "seed": 12345,
  "snapshot": {
    "marketplace": {
      "stateVersion": 1,
      "users": [],
      "items": [],
      "listings": [],
      "transactions": [],
      "likes": []
    }
  }
}
```

### `POST /worlds/{world_id}/step`

`steps` controls the number of Mesa ticks. `speed` is simulated minutes per
tick; it changes activity-hour eligibility without multiplying work. Supplying
`snapshot` reconciles the sidecar with the authoritative application state.
For a registry miss, include both `snapshot` and `seed` to re-bootstrap.

The response contains ordered `command_intents`, matching synthetic events,
and the latest DataCollector metrics. Intents include stable idempotency keys
and must be validated again by the application command layer.

### `POST /worlds/{world_id}/agent-goal`

Builds a deterministic buyer plan from a natural-language goal, optional
budget/interests, and the current listings. Candidate browsing and any proposed
offer are returned as intents; this endpoint also performs no transaction.

## Determinism and safety

- The same normalized snapshot, world ID, seed, step count, and speed produce
  the same intent/event sequence after a fresh bootstrap.
- Timestamps are based on a fixed virtual epoch plus simulated minutes.
- Input Pydantic models are deep-copied before use.
- IDs and idempotency keys derive from canonical state and command content.
- The model can reserve budget or a listing in its own shadow state, but only
  the TypeScript domain layer may accept/reject and persist an intent.
