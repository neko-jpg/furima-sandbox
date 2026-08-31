from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

import pytest

from services.listing_photo_assistant import agent
from services.listing_photo_assistant.config import BackendSettings
from services.listing_photo_assistant.live_agent import entrypoint
from services.listing_photo_assistant.providers.runtime import create_provider_inference
from services.listing_photo_assistant.providers.vision_guidance import GuidanceCode


@dataclass
class Publisher:
    calls: list[tuple[dict[str, object], bool]] = field(default_factory=list)

    async def publish_data(self, payload: bytes, *, reliable: bool, topic: str) -> None:
        self.calls.append((json.loads(payload), reliable))


@dataclass
class Room:
    local_participant: Publisher
    name: str = "capture-session"
    remote_participants: list[object] = field(default_factory=list)
    handlers: dict[str, Any] = field(default_factory=dict)

    def on(self, event: str, callback: Any) -> None:
        self.handlers[event] = callback


class Context:
    def __init__(self, room: Room) -> None:
        self.room = room
        self.shutdown_callbacks: list[Any] = []

    async def connect(self, **_kwargs: Any) -> None:
        return None

    def add_shutdown_callback(self, callback: Any) -> None:
        self.shutdown_callbacks.append(callback)


@pytest.mark.asyncio
async def test_agent_server_wires_shot_aware_provider_and_reconnect_lifecycle() -> None:
    seen_shots: list[str] = []
    captured: dict[str, Any] = {}

    async def analyzer(input_value: Any) -> dict[str, object]:
        seen_shots.append(input_value.requestedShot)
        return {"code": "READY", "confidence": 1.0}

    settings = BackendSettings(
        provider_mode="live",
        livekit_url="wss://room.example.invalid",
        livekit_api_key="key",
        livekit_api_secret="secret",
    )

    def server_factory(**kwargs: Any) -> object:
        captured.update(kwargs)
        return object()

    agent.run_agent_worker(
        settings,
        runner=lambda _server: None,
        live_analyzer=analyzer,
        server_factory=server_factory,
    )
    assert "transport_factory" in captured

    publisher = Publisher()
    room = Room(publisher)
    runtime = await entrypoint(
        Context(room),
        inference=captured["inference"],
        transport_factory=captured["transport_factory"],
    )
    assert runtime.guidance_transport is not None
    assert runtime.guidance_transport.session_id == "capture-session"

    await runtime.set_shot("back")
    assert runtime.subscriber.processor.submit_nowait(b"back-frame") is True
    await runtime.subscriber.processor.wait_idle()

    assert seen_shots == ["back"]
    assert [
        (payload.get("type", "guidance"), payload["shot"], reliable)
        for payload, reliable in publisher.calls
    ] == [("shot_changed", "back", True), ("guidance", "back", False)]
    assert publisher.calls[-1][0]["code"] == GuidanceCode.READY.value

    room.handlers["reconnecting"]()
    await asyncio.sleep(0)
    assert runtime.guidance_transport.connected is False
    room.handlers["reconnected"]()
    await asyncio.sleep(0)
    assert runtime.guidance_transport.connected is True
    assert publisher.calls[-1][0]["type"] == "resync"
    assert publisher.calls[-1][1] is True

    sent_before_close = len(publisher.calls)
    await runtime.close()
    await runtime.close()
    assert runtime.subscriber.processor.submit_nowait(b"closed-frame") is False
    await asyncio.sleep(0)
    assert len(publisher.calls) == sent_before_close


@pytest.mark.asyncio
async def test_failed_reliable_shot_publish_fences_runtime_until_resync() -> None:
    class FailingPublisher(Publisher):
        failures_remaining = 1

        async def publish_data(self, payload: bytes, *, reliable: bool, topic: str) -> None:
            self.calls.append((json.loads(payload), reliable))
            if reliable and self.failures_remaining:
                self.failures_remaining -= 1
                raise RuntimeError("reliable packet unavailable")

    settings = BackendSettings(provider_mode="fixture")
    provider = agent.build_runtime_provider(settings)
    publisher = FailingPublisher()
    runtime = await entrypoint(
        Context(Room(publisher)),
        inference=create_provider_inference(provider),
        transport_factory=agent.build_transport_factory(provider),
    )

    with pytest.raises(RuntimeError, match="reliable packet unavailable"):
        await runtime.set_shot("back")

    assert runtime.current_shot == "back"
    assert runtime.guidance_transport is not None
    assert runtime.guidance_transport.current_shot is not None
    assert runtime.guidance_transport.current_shot.value == "back"
    assert runtime.guidance_transport.connected is False

    await runtime.on_reconnected()
    assert runtime.guidance_transport.connected is True
    assert publisher.calls[-1][0]["type"] == "resync"
    assert publisher.calls[-1][0]["shot"] == "back"

    assert runtime.subscriber.processor.submit_nowait(b"back-frame") is True
    await runtime.subscriber.processor.wait_idle()
    assert publisher.calls[-1][0]["shot"] == "back"
    await runtime.close()
