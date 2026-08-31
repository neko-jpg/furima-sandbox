from __future__ import annotations

import asyncio
import json
import math

import pytest

from services.listing_photo_assistant.guidance_state_machine import (
    GuidanceEvent,
    GuidanceStateMachine,
)
from services.listing_photo_assistant.guidance_transport import (
    GuidanceTransportAdapter,
    GuidanceTransportError,
    encode_guidance_event,
)


class Publisher:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, object], bool]] = []

    async def publish_data(self, payload: bytes, *, reliable: bool) -> None:
        self.calls.append((json.loads(payload), reliable))


class FailOncePublisher(Publisher):
    def __init__(self) -> None:
        super().__init__()
        self.failures_remaining = 1

    async def publish_data(self, payload: bytes, *, reliable: bool) -> None:
        if reliable and self.failures_remaining:
            self.failures_remaining -= 1
            raise RuntimeError("reliable data channel unavailable")
        await super().publish_data(payload, reliable=reliable)


@pytest.mark.asyncio
async def test_transport_publishes_reliable_state_before_lossy_guidance() -> None:
    publisher = Publisher()

    async def infer(_frame: object) -> object:
        return {"code": "READY", "confidence": 0.8}

    adapter = GuidanceTransportAdapter(
        infer,
        publisher,
        state_machine=GuidanceStateMachine("transport", clock=lambda: 1_000),
    )

    event = await adapter.process_frame(b"frame", shot="front")
    assert event is not None
    assert event.message == "撮影できます。"
    assert [(payload.get("type", "guidance"), reliable) for payload, reliable in publisher.calls] == [
        ("shot_changed", True),
        ("guidance", False),
    ]


@pytest.mark.asyncio
async def test_disconnect_fences_inflight_result_and_reconnect_resyncs_first() -> None:
    publisher = Publisher()
    started = asyncio.Event()
    release = asyncio.Event()

    async def infer(_frame: object) -> object:
        started.set()
        await release.wait()
        return {"code": "READY", "confidence": 1.0}

    adapter = GuidanceTransportAdapter(
        infer,
        publisher,
        state_machine=GuidanceStateMachine("transport", clock=lambda: 1_000),
    )
    in_flight = asyncio.create_task(adapter.process_frame(b"old", shot="front"))
    await started.wait()
    assert await adapter.mark_disconnected() is True
    release.set()
    assert await in_flight is None
    assert [payload.get("type", "guidance") for payload, _ in publisher.calls] == ["shot_changed"]

    snapshot = await adapter.on_reconnected()
    assert snapshot.sequence == 2
    event = await adapter.process_frame(b"new", shot="front")
    assert event is not None
    assert [payload.get("type", "guidance") for payload, _ in publisher.calls] == [
        "shot_changed",
        "resync",
        "guidance",
    ]
    assert [payload["sequence"] for payload, _ in publisher.calls] == [1, 2, 3]


@pytest.mark.asyncio
async def test_failed_reliable_publish_fences_until_resync() -> None:
    publisher = FailOncePublisher()

    async def infer(_frame: object) -> object:
        return {"code": "READY", "confidence": 1.0}

    adapter = GuidanceTransportAdapter(infer, publisher, session_id="transport")
    with pytest.raises(RuntimeError, match="reliable"):
        await adapter.set_shot("front")
    assert adapter.current_shot is not None
    assert adapter.connected is False
    with pytest.raises(GuidanceTransportError):
        await adapter.process_frame(b"blocked", shot="front")

    snapshot = await adapter.on_reconnected()
    assert snapshot.sequence == 2
    assert await adapter.process_frame(b"new", shot="front") is not None
    assert [payload.get("type", "guidance") for payload, _ in publisher.calls] == [
        "resync",
        "guidance",
    ]


def test_transport_encoder_rejects_provider_copy_and_non_finite_values() -> None:
    with pytest.raises(GuidanceTransportError):
        encode_guidance_event(
            GuidanceEvent(
                session_id="transport",
                sequence=1,
                shot="front",  # type: ignore[arg-type]
                code="READY",  # type: ignore[arg-type]
                message="provider text",
                confidence=1.0,
                observed_at=1,
                expires_at=2,
            )
        )
    with pytest.raises(ValueError):
        GuidanceEvent(
            session_id="transport",
            sequence=1,
            shot="front",  # type: ignore[arg-type]
            code="READY",  # type: ignore[arg-type]
            message="撮影できます。",
            confidence=math.nan,
            observed_at=1,
            expires_at=2,
        )
