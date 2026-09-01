from __future__ import annotations

import asyncio

import pytest

from services.listing_photo_assistant.agent import build_runtime_provider, check_agent
from services.listing_photo_assistant.config import BackendSettings
from services.listing_photo_assistant.guidance_state_machine import (
    GuidanceStateMachine,
    TransportKind,
)
from services.listing_photo_assistant.live_agent import (
    AgentRuntime,
    CameraVideoTrackSubscriber,
    GuidancePacketPublisher,
    InferenceBudgetExceeded,
    LatestFrameProcessor,
    LatestFrameSlot,
    create_default_guidance_inference,
    is_camera_video_track,
    session_id_from_room_name,
)
from services.listing_photo_assistant.providers.vision_guidance import (
    EncodedImage,
    FixtureVisionGuidanceProvider,
    GuidanceInput,
    GuidanceCode,
    GuidanceShot,
    LiveVisionGuidanceProvider,
    LiveVisionProviderUnavailable,
)
from services.listing_photo_assistant.providers.errors import ProviderError


@pytest.mark.asyncio
async def test_guidance_sequence_deduplication_and_fixture_provider() -> None:
    machine = GuidanceStateMachine("session-a", clock=lambda: 10_000)
    input_value = GuidanceInput(EncodedImage(b"frame"), "front")  # type: ignore[arg-type]
    event = await machine.analyze(FixtureVisionGuidanceProvider(), input_value)
    assert event is not None
    assert event.code is GuidanceCode.READY
    assert event.transport is TransportKind.LOSSY
    assert machine.emit("front", {"code": "READY", "confidence": 0.2}) is None

    changed = machine.set_shot("back")
    assert changed.transport is TransportKind.RELIABLE
    assert changed.sequence == 2


def test_guidance_room_name_and_packet_publisher_keep_wire_contract() -> None:
    assert session_id_from_room_name("listing-photo-session-guided-123") == "guided-123"


@pytest.mark.asyncio
async def test_guidance_packet_publisher_sends_only_event_payload() -> None:
    class Participant:
        def __init__(self) -> None:
            self.payloads: list[tuple[bytes, bool, str]] = []

        async def publish_data(self, payload: bytes, *, reliable: bool, topic: str) -> None:
            self.payloads.append((payload, reliable, topic))

    class Room:
        def __init__(self) -> None:
            self.local_participant = Participant()

    room = Room()
    machine = GuidanceStateMachine("guided-123", clock=lambda: 1000)
    event = machine.emit("front", {"code": "READY", "confidence": 1.0})
    assert event is not None
    await GuidancePacketPublisher(room).publish(event)
    payload, reliable, topic = room.local_participant.payloads[0]
    assert reliable is False
    assert topic == "guidance"
    assert b"guided-123" in payload
    assert b"READY" in payload


@pytest.mark.asyncio
async def test_guidance_packet_publisher_marks_reliable_state_packets() -> None:
    class Participant:
        def __init__(self) -> None:
            self.payloads: list[tuple[bytes, bool, str]] = []

        async def publish_data(self, payload: bytes, *, reliable: bool, topic: str) -> None:
            self.payloads.append((payload, reliable, topic))

    class Room:
        def __init__(self) -> None:
            self.local_participant = Participant()

    room = Room()
    machine = GuidanceStateMachine("guided-123", clock=lambda: 1000)
    event = machine.set_shot("back")
    await GuidancePacketPublisher(room).publish_state(event)
    payload, reliable, topic = room.local_participant.payloads[0]
    assert reliable is True
    assert topic == "guidance"
    assert b'"type":"shot_changed"' in payload
    assert b'"shot":"back"' in payload


@pytest.mark.asyncio
async def test_agent_runtime_handles_only_session_scoped_control_messages() -> None:
    class Participant:
        def __init__(self) -> None:
            self.payloads: list[tuple[bytes, bool, str]] = []

        async def publish_data(self, payload: bytes, *, reliable: bool, topic: str) -> None:
            self.payloads.append((payload, reliable, topic))

    class Room:
        def __init__(self) -> None:
            self.local_participant = Participant()

    class Subscriber:
        async def stop(self) -> None:
            return None

    room = Room()
    machine = GuidanceStateMachine("guided-123", clock=lambda: 1000)
    runtime = AgentRuntime(
        room=room,
        subscriber=Subscriber(),  # type: ignore[arg-type]
        machine=machine,
        publisher=GuidancePacketPublisher(room),
    )

    assert await runtime.handle_control(
        {"type": "set_shot", "sessionId": "wrong", "shot": "back"}
    ) is False
    assert await runtime.handle_control(
        {"type": "set_shot", "sessionId": "guided-123", "shot": "back"}
    ) is True
    assert runtime.current_shot == "back"
    assert room.local_participant.payloads[0][1] is True
    assert b'"type":"shot_changed"' in room.local_participant.payloads[0][0]

    assert await runtime.handle_control({"type": "resync", "sessionId": "guided-123"}) is True
    assert len(room.local_participant.payloads) == 2
    assert b'"type":"resync"' in room.local_participant.payloads[1][0]


@pytest.mark.asyncio
async def test_default_fixture_guidance_inference_returns_valid_decision() -> None:
    infer = create_default_guidance_inference()
    decision = await infer(b"frame")
    assert decision.code is GuidanceCode.READY


@pytest.mark.asyncio
async def test_live_guidance_provider_delegates_to_an_injected_analyzer() -> None:
    inputs: list[GuidanceInput] = []

    async def analyze(input_value: GuidanceInput) -> dict[str, object]:
        inputs.append(input_value)
        return {"code": "CENTER_GARMENT", "confidence": 0.75}

    provider = LiveVisionGuidanceProvider(analyzer=analyze)
    input_value = GuidanceInput(EncodedImage(b"frame"), "front")  # type: ignore[arg-type]
    decision = await provider.analyze(input_value)

    assert provider.available is True
    assert decision.code is GuidanceCode.CENTER_GARMENT
    assert decision.confidence == 0.75
    assert inputs == [input_value]


@pytest.mark.asyncio
async def test_live_guidance_without_injection_fails_without_fixture_fallback() -> None:
    provider = LiveVisionGuidanceProvider()
    input_value = GuidanceInput(EncodedImage(b"frame"), "front")  # type: ignore[arg-type]

    assert provider.available is False
    with pytest.raises(LiveVisionProviderUnavailable):
        await provider.analyze(input_value)


def test_agent_provider_selection_is_explicit_and_constructible_offline() -> None:
    fixture = BackendSettings("fixture", "127.0.0.1", 3001)
    live = BackendSettings("live", "127.0.0.1", 3001)

    fixture_provider = build_runtime_provider(fixture)
    assert isinstance(fixture_provider, FixtureVisionGuidanceProvider)

    with pytest.raises(ProviderError) as error:
        build_runtime_provider(live)
    assert error.value.code.value == "UNAVAILABLE"

    checked = check_agent(fixture, server_factory=lambda **_: object())
    assert isinstance(checked, FixtureVisionGuidanceProvider)


@pytest.mark.asyncio
async def test_guidance_state_machine_drops_inflight_result_from_old_shot() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowProvider:
        async def analyze(self, input_value: GuidanceInput) -> dict[str, object]:
            assert input_value.requested_shot is GuidanceShot.FRONT
            started.set()
            await release.wait()
            return {"code": "READY", "confidence": 1.0}

    machine = GuidanceStateMachine("session-stale", clock=lambda: 10_000)
    task = asyncio.create_task(
        machine.analyze(
            SlowProvider(),
            GuidanceInput(EncodedImage(b"frame"), "front"),  # type: ignore[arg-type]
        )
    )
    await started.wait()
    machine.set_shot("back")
    release.set()

    assert await task is None
    assert machine.current_shot.value == "back"


def test_guidance_event_stale_predicate_checks_session_sequence_shot_and_expiry() -> None:
    machine = GuidanceStateMachine("session-stale", clock=lambda: 1_000, guidance_ttl_ms=100)
    event = machine.emit("front", {"code": "READY", "confidence": 1.0})
    assert event is not None
    assert event.is_stale(
        1_050,
        session_id="session-stale",
        last_sequence=0,
        expected_shot="front",
    ) is False
    assert event.is_stale(1_050, session_id="other") is True
    assert event.is_stale(1_050, last_sequence=event.sequence) is True
    assert event.is_stale(1_050, expected_shot="back") is True
    assert event.is_stale(1_100) is True


def test_latest_frame_slot_is_capacity_one() -> None:
    slot: LatestFrameSlot[str] = LatestFrameSlot()
    assert slot.put("first") is False
    assert slot.put("latest") is True
    assert slot.qsize == 1
    assert slot.qsize() == 1
    assert slot.take() == "latest"
    assert slot.replaced_count == 1
    slot.close()
    assert slot.put("after-close") is False


@pytest.mark.asyncio
async def test_processor_keeps_one_inference_in_flight_and_newest_pending_frame() -> None:
    release = asyncio.Event()
    started = asyncio.Event()
    processed: list[str] = []
    active = 0
    max_active = 0

    async def infer(frame: str) -> str:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        processed.append(frame)
        if frame == "first":
            started.set()
            await release.wait()
        active -= 1
        return frame

    processor = LatestFrameProcessor(infer)
    assert processor.submit_nowait("first") is True
    await started.wait()
    for index in range(5):
        assert processor.submit_nowait(f"pending-{index}") is True
    release.set()
    await processor.wait_idle()

    assert processed == ["first", "pending-4"]
    assert processor.max_in_flight == 1
    assert max_active == 1
    assert processor.dropped_count >= 4
    processor.stop()


@pytest.mark.asyncio
async def test_processor_enforces_bounded_inference_cadence() -> None:
    release = asyncio.Event()
    first_started = asyncio.Event()
    started_at: list[float] = []

    async def infer(frame: str) -> str:
        started_at.append(asyncio.get_running_loop().time())
        if frame == "first":
            first_started.set()
            await release.wait()
        return frame

    processor = LatestFrameProcessor(infer, min_interval_seconds=0.03)
    assert processor.max_fps == pytest.approx(1 / 0.03)
    processor.submit_nowait("first")
    await first_started.wait()
    processor.submit_nowait("second")
    release.set()
    await processor.wait_idle()

    assert len(started_at) == 2
    assert started_at[1] - started_at[0] >= 0.02
    processor.stop()


@pytest.mark.asyncio
async def test_processor_stops_at_session_budget_and_reports_it_once() -> None:
    calls: list[str] = []
    errors: list[BaseException] = []

    async def infer(frame: str) -> str:
        calls.append(frame)
        return frame

    def on_error(error: BaseException, _frame: str) -> None:
        errors.append(error)

    processor = LatestFrameProcessor(
        infer,
        on_error=on_error,
        min_interval_seconds=0,
        max_inference_calls=2,
    )
    assert processor.submit_nowait("first") is True
    await processor.wait_idle()
    assert processor.submit_nowait("second") is True
    await processor.wait_idle()

    assert calls == ["first", "second"]
    assert processor.inference_count == 2
    assert processor.remaining_calls == 0
    assert processor.budget_exhausted is True
    assert processor.submit_nowait("after-budget") is False
    assert [error for error in errors if isinstance(error, InferenceBudgetExceeded)]
    assert len([error for error in errors if isinstance(error, InferenceBudgetExceeded)]) == 1


@pytest.mark.asyncio
async def test_processor_applies_failure_cooldown_before_retrying() -> None:
    started_at: list[float] = []
    attempts = 0

    async def infer(frame: str) -> str:
        nonlocal attempts
        del frame
        attempts += 1
        started_at.append(asyncio.get_running_loop().time())
        if attempts == 1:
            raise RuntimeError("temporary provider failure")
        return "ok"

    processor = LatestFrameProcessor(
        infer,
        min_interval_seconds=0,
        max_inference_calls=3,
        failure_cooldown_seconds=0.03,
    )
    assert processor.submit_nowait("first") is True
    await processor.wait_idle()
    assert processor.submit_nowait("retry") is True
    await processor.wait_idle()

    assert len(started_at) == 2
    assert started_at[1] - started_at[0] >= 0.02
    processor.stop()


class FakeTrack:
    def __init__(self, kind: object, source: object) -> None:
        self.kind = kind
        self.source = source


class FakePublication:
    def __init__(self, kind: object, source: object, track: FakeTrack) -> None:
        self.kind = kind
        self.source = source
        self.track = track
        self.subscribed: list[bool] = []

    async def set_subscribed(self, value: bool) -> None:
        self.subscribed.append(value)


class FakeStream:
    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(3600)
        raise StopAsyncIteration

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_subscriber_rejects_audio_and_screen_tracks() -> None:
    processor = LatestFrameProcessor(lambda frame: frame)
    streams: list[FakeStream] = []

    async def stream_factory(track: FakeTrack) -> FakeStream:
        del track
        stream = FakeStream()
        streams.append(stream)
        return stream

    subscriber = CameraVideoTrackSubscriber(processor, stream_factory=stream_factory)
    camera = FakePublication("video", "camera", FakeTrack("video", "camera"))
    audio = FakePublication("audio", "microphone", FakeTrack("audio", "microphone"))
    screen = FakePublication("video", "screen_share", FakeTrack("video", "screen_share"))

    assert is_camera_video_track(camera.track) is True
    assert await subscriber.subscribe_publication(camera) is True
    assert await subscriber.subscribe_publication(audio) is False
    assert await subscriber.subscribe_publication(screen) is False
    assert camera.subscribed == [True]
    assert audio.subscribed == [False]
    assert screen.subscribed == [False]
    assert len(streams) == 1
    await subscriber.stop()
