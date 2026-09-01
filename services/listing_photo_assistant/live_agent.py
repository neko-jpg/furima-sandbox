"""LiveKit camera-track ingestion with bounded latest-frame backpressure.

LiveKit SDK imports are intentionally lazy.  The frame policy is useful in
fixture mode and can be tested without a room, while the optional runtime
adapters enforce camera-only subscriptions and one inference in flight.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import threading
import time
from collections.abc import AsyncIterable, Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Generic, Literal, Optional, TypeVar

from .settings import (
    BackendSettings,
    DEFAULT_GUIDANCE_CADENCE_SECONDS,
    DEFAULT_GUIDANCE_FAILURE_COOLDOWN_SECONDS,
    DEFAULT_GUIDANCE_MAX_CALLS_PER_SESSION,
)
from .guidance_transport import GuidanceTransportAdapter, encode_guidance_event
from .guidance_state_machine import (
    GuidanceEvent,
    GuidanceStateEvent,
    GuidanceStateMachine,
)
from .providers.vision_guidance import (
    EncodedImage,
    FixtureVisionGuidanceProvider,
    GuidanceCode,
    GuidanceContractError,
    GuidanceInput,
    GuidanceShot,
    LiveVisionAnalyzer,
    LiveVisionGuidanceProvider,
    VisionDecision,
    VisionGuidanceProvider,
    validate_guidance_shot,
    validate_vision_decision,
)


FrameT = TypeVar("FrameT")
ResultT = TypeVar("ResultT")
Shot = Literal["front", "back", "tag", "measurement"]


class _QueueSize(int):
    def __call__(self) -> int:
        return int(self)


class FrameSlotClosed(RuntimeError):
    """Optional strict error for callers that reject closed submissions."""


class InferenceBudgetExceeded(RuntimeError):
    """Raised through the error sink when a session reaches its call budget."""

    def __init__(self, max_calls: int) -> None:
        self.max_calls = max_calls
        super().__init__(f"guidance inference budget exhausted after {max_calls} calls")


class LatestFrameSlot(Generic[FrameT]):
    """Thread-safe capacity-one slot that always retains the newest frame."""

    maxsize = 1

    def __init__(self) -> None:
        self._frame: Optional[FrameT] = None
        self._has_frame = False
        self._closed = False
        self._replaced_count = 0
        self._accepted_count = 0
        self._lock = threading.RLock()

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    @property
    def qsize(self) -> _QueueSize:
        with self._lock:
            return _QueueSize(1 if self._has_frame else 0)

    @property
    def size(self) -> int:
        return self.qsize

    @property
    def replaced_count(self) -> int:
        with self._lock:
            return self._replaced_count

    @property
    def accepted_count(self) -> int:
        with self._lock:
            return self._accepted_count

    def put(self, frame: FrameT) -> bool:
        with self._lock:
            if self._closed:
                return False
            replaced = self._has_frame
            if replaced:
                self._replaced_count += 1
            self._frame = frame
            self._has_frame = True
            self._accepted_count += 1
            return replaced

    put_latest = put
    offer = put

    def take(self) -> Optional[FrameT]:
        with self._lock:
            if not self._has_frame:
                return None
            frame = self._frame
            self._frame = None
            self._has_frame = False
            return frame

    get_latest = take
    pop = take

    def peek(self) -> Optional[FrameT]:
        with self._lock:
            return self._frame if self._has_frame else None

    def clear(self) -> Optional[FrameT]:
        return self.take()

    def close(self) -> Optional[FrameT]:
        with self._lock:
            self._closed = True
            frame = self._frame if self._has_frame else None
            self._frame = None
            self._has_frame = False
            return frame

    def __len__(self) -> int:
        return self.qsize

    def empty(self) -> bool:
        return self.qsize == 0

    def full(self) -> bool:
        return self.qsize == self.maxsize

    put_nowait = put
    get_nowait = take


Inference = Callable[[FrameT], ResultT | Awaitable[ResultT]]
ResultSink = Callable[[ResultT, FrameT], Any]
ErrorSink = Callable[[BaseException, FrameT], Any]
MonotonicClock = Callable[[], float]
GuidanceTransportFactory = Callable[[Any, Callable[[], Shot]], GuidanceTransportAdapter]


class LatestFrameProcessor(Generic[FrameT, ResultT]):
    """Run at most one inference and coalesce pending frames to the newest."""

    max_concurrency = 1

    def __init__(
        self,
        inference: Optional[Inference[FrameT, ResultT]] = None,
        *,
        infer: Optional[Inference[FrameT, ResultT]] = None,
        on_result: Optional[ResultSink[ResultT, FrameT]] = None,
        on_error: Optional[ErrorSink] = None,
        slot: Optional[LatestFrameSlot[FrameT]] = None,
        min_interval_seconds: float = 0.5,
        cadence_seconds: float | None = None,
        max_fps: float | None = None,
        clock: MonotonicClock | None = None,
        max_inference_calls: int | None = None,
        failure_cooldown_seconds: float = 0.0,
    ) -> None:
        selected = inference if inference is not None else infer
        if selected is None:
            raise TypeError("LatestFrameProcessor requires an inference callback")
        self._inference = selected
        self._on_result = on_result
        self._on_error = on_error
        self.slot = slot if slot is not None else LatestFrameSlot()
        if cadence_seconds is not None and max_fps is not None:
            raise TypeError("provide cadence_seconds or max_fps, not both")
        if max_fps is not None:
            if (
                isinstance(max_fps, bool)
                or not isinstance(max_fps, (int, float))
                or not float(max_fps) > 0.0
                or not float(max_fps) < float("inf")
            ):
                raise ValueError("max_fps must be a finite positive number")
            selected_interval = 1.0 / float(max_fps)
        else:
            selected_interval = (
                min_interval_seconds if cadence_seconds is None else cadence_seconds
            )
        if (
            isinstance(selected_interval, bool)
            or not isinstance(selected_interval, (int, float))
            or not float(selected_interval) >= 0.0
            or not float(selected_interval) < float("inf")
        ):
            raise ValueError("min_interval_seconds must be a finite non-negative number")
        if max_inference_calls is not None and (
            isinstance(max_inference_calls, bool)
            or not isinstance(max_inference_calls, int)
            or max_inference_calls <= 0
        ):
            raise ValueError("max_inference_calls must be a positive integer or None")
        if (
            isinstance(failure_cooldown_seconds, bool)
            or not isinstance(failure_cooldown_seconds, (int, float))
            or float(failure_cooldown_seconds) < 0.0
            or float(failure_cooldown_seconds) >= float("inf")
        ):
            raise ValueError("failure_cooldown_seconds must be a finite non-negative number")
        self._min_interval_seconds = float(selected_interval)
        self._max_inference_calls = max_inference_calls
        self._failure_cooldown_seconds = float(failure_cooldown_seconds)
        self._clock = clock or time.monotonic
        self._next_inference_at = 0.0
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._closed = False
        self._in_flight = 0
        self._max_in_flight = 0
        self._processed_count = 0
        self._inference_count = 0
        self._error_count = 0
        self._max_pending = 0
        self._last_frame: Optional[FrameT] = None
        self._last_result: Optional[ResultT] = None
        self._last_error: Optional[BaseException] = None
        self._budget_exhausted = False
        self._budget_error_reported = False

    @property
    def queue(self) -> LatestFrameSlot[FrameT]:
        return self.slot

    @property
    def latest_frame(self) -> Optional[FrameT]:
        return self.slot.peek()

    @property
    def pending_count(self) -> int:
        return self.slot.qsize

    @property
    def queue_size(self) -> int:
        return self.slot.qsize

    @property
    def in_flight(self) -> int:
        return self._in_flight

    @property
    def inference_in_flight(self) -> bool:
        return self._in_flight == 1

    @property
    def max_in_flight(self) -> int:
        return self._max_in_flight

    @property
    def min_interval_seconds(self) -> float:
        return self._min_interval_seconds

    @property
    def max_inference_calls(self) -> int | None:
        return self._max_inference_calls

    @property
    def failure_cooldown_seconds(self) -> float:
        return self._failure_cooldown_seconds

    @property
    def inference_count(self) -> int:
        """Number of provider attempts started, including failed attempts."""

        return self._inference_count

    @property
    def remaining_calls(self) -> int | None:
        if self._max_inference_calls is None:
            return None
        return max(0, self._max_inference_calls - self._inference_count)

    @property
    def budget_exhausted(self) -> bool:
        return self._budget_exhausted

    @property
    def max_fps(self) -> float | None:
        """Return the configured maximum inference rate."""

        if self._min_interval_seconds == 0.0:
            return None
        return 1.0 / self._min_interval_seconds

    @property
    def max_pending(self) -> int:
        return self._max_pending

    @property
    def max_queue_size(self) -> int:
        return self._max_pending

    @property
    def processed_count(self) -> int:
        return self._processed_count

    @property
    def dropped_count(self) -> int:
        return self.slot.replaced_count

    @property
    def last_processed_frame(self) -> Optional[FrameT]:
        return self._last_frame

    @property
    def last_result(self) -> Optional[ResultT]:
        return self._last_result

    @property
    def last_error(self) -> Optional[BaseException]:
        return self._last_error

    @property
    def error_count(self) -> int:
        return self._error_count

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def worker_task(self) -> Optional[asyncio.Task[None]]:
        return self._worker_task

    async def submit(self, frame: FrameT) -> bool:
        return self.submit_nowait(frame)

    async def enqueue(self, frame: FrameT) -> bool:
        return await self.submit(frame)

    async def process(self, frame: FrameT) -> bool:
        return await self.submit(frame)

    async def submit_frame(self, frame: FrameT) -> bool:
        return await self.submit(frame)

    def submit_nowait(self, frame: FrameT) -> bool:
        if self._closed or self._budget_exhausted:
            return False
        if (
            self._max_inference_calls is not None
            and self._inference_count >= self._max_inference_calls
        ):
            self._budget_exhausted = True
            return False
        self.slot.put(frame)
        self._max_pending = max(self._max_pending, int(self.slot.qsize))
        self._ensure_worker()
        return True

    push = submit_nowait
    offer = submit_nowait

    def _ensure_worker(self) -> None:
        if self._closed:
            return
        task = self._worker_task
        if task is not None and not task.done():
            return
        loop = asyncio.get_running_loop()
        self._worker_task = loop.create_task(
            self._drain(), name="listing-photo-latest-frame-processor"
        )

    async def _drain(self) -> None:
        try:
            while not self._closed:
                frame = self.slot.take()
                if frame is None and not self.slot.empty():
                    # A caller may intentionally submit None as a frame.  The
                    # slot still tracks occupancy; no normal camera frame is
                    # None, so this is only a defensive branch.
                    continue
                if frame is None:
                    self._worker_task = None
                    return

                if (
                    self._max_inference_calls is not None
                    and self._inference_count >= self._max_inference_calls
                ):
                    self._budget_exhausted = True
                    self.slot.clear()
                    await self._notify_budget_exhausted(frame)
                    return

                now = self._clock()
                wait_seconds = self._next_inference_at - now
                if wait_seconds > 0:
                    await asyncio.sleep(wait_seconds)
                if self._min_interval_seconds:
                    # Rate-limit inference starts. A slow provider naturally
                    # consumes the interval; a fast provider cannot exceed
                    # the configured cadence.
                    self._next_inference_at = (
                        self._clock() + self._min_interval_seconds
                    )

                self._in_flight = 1
                self._max_in_flight = max(self._max_in_flight, self._in_flight)
                self._inference_count += 1
                if (
                    self._max_inference_calls is not None
                    and self._inference_count >= self._max_inference_calls
                ):
                    # Reject newly arriving camera frames while the final
                    # provider request is still in flight.
                    self._budget_exhausted = True
                self._last_error = None
                try:
                    result = self._inference(frame)
                    if inspect.isawaitable(result):
                        result = await result
                    self._last_result = result
                    self._last_frame = frame
                    self._processed_count += 1
                    if self._on_result is not None:
                        sink_result = self._on_result(result, frame)
                        if inspect.isawaitable(sink_result):
                            await sink_result
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    self._last_error = error
                    self._error_count += 1
                    if self._failure_cooldown_seconds:
                        self._next_inference_at = max(
                            self._next_inference_at,
                            self._clock() + self._failure_cooldown_seconds,
                        )
                    if self._on_error is not None:
                        sink_error = self._on_error(error, frame)
                        if inspect.isawaitable(sink_error):
                            await sink_error
                finally:
                    self._in_flight = 0
                if self._budget_exhausted:
                    self.slot.clear()
                    await self._notify_budget_exhausted(frame)
                    return
        finally:
            if self._worker_task is asyncio.current_task():
                self._worker_task = None

    async def _notify_budget_exhausted(self, frame: FrameT) -> None:
        if self._budget_error_reported or self._max_inference_calls is None:
            return
        self._budget_error_reported = True
        error = InferenceBudgetExceeded(self._max_inference_calls)
        self._last_error = error
        self._error_count += 1
        if self._on_error is not None:
            sink_error = self._on_error(error, frame)
            if inspect.isawaitable(sink_error):
                await sink_error

    async def wait_idle(self) -> None:
        while True:
            task = self._worker_task
            if task is None:
                return
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                return

    async def flush(self) -> None:
        await self.wait_idle()

    def stop(self, *, cancel: bool = True) -> None:
        self._closed = True
        self.slot.close()
        task = self._worker_task
        if cancel and task is not None and not task.done():
            task.cancel()

    close = stop

    async def aclose(self, *, cancel: bool = True) -> None:
        self.stop(cancel=cancel)
        await self.wait_idle()


def _enum_strings(value: Any) -> set[str]:
    if value is None:
        return set()
    values: list[Any] = [value]
    if isinstance(value, Enum):
        values.extend((value.name, value.value))
    else:
        for attribute in ("name", "value"):
            candidate = getattr(value, attribute, None)
            if candidate is not None:
                values.append(candidate)
    result: set[str] = set()
    for candidate in values:
        text = candidate.strip().lower() if isinstance(candidate, str) else str(candidate).strip().lower()
        result.update({text, text.replace("_", ""), text.replace("-", "")})
    return result


def is_video_kind(value: Any) -> bool:
    try:
        from livekit import rtc  # type: ignore[import-not-found]

        expected = getattr(getattr(rtc, "TrackKind", None), "KIND_VIDEO", None)
        if expected is not None and value == expected:
            return True
    except (ImportError, AttributeError, TypeError, ValueError):
        pass
    values = _enum_strings(value)
    return any(
        token in values
        for token in (
            "video",
            "kind_video",
            "kindvideo",
            "trackkindvideo",
            "trackkind_video",
        )
    ) or any(token.endswith("kindvideo") for token in values)


def is_camera_source(value: Any) -> bool:
    try:
        from livekit import rtc  # type: ignore[import-not-found]

        expected = getattr(getattr(rtc, "TrackSource", None), "SOURCE_CAMERA", None)
        if expected is not None and value == expected:
            return True
    except (ImportError, AttributeError, TypeError, ValueError):
        pass
    values = _enum_strings(value)
    return any(
        token in values
        for token in (
            "camera",
            "source_camera",
            "sourcecamera",
            "tracksourcesourcecamera",
            "tracksourcesource_camera",
        )
    ) or any(token.endswith("sourcecamera") for token in values)


def _publication_kind(publication: Any, track: Any = None) -> Any:
    kind = getattr(publication, "kind", None)
    return getattr(track, "kind", None) if kind is None else kind


def _publication_source(publication: Any, track: Any = None) -> Any:
    source = getattr(publication, "source", None)
    return getattr(track, "source", None) if source is None else source


def is_camera_video_track(track: Any, publication: Any = None) -> bool:
    if publication is not None:
        kind = _publication_kind(publication, track)
        source = _publication_source(publication, track)
    else:
        kind = getattr(track, "kind", None)
        source = getattr(track, "source", None)
    return is_video_kind(kind) and is_camera_source(source)


def is_camera_video_publication(publication: Any) -> bool:
    return is_camera_video_track(getattr(publication, "track", None), publication)


def should_subscribe_to_publication(publication: Any) -> bool:
    return is_camera_video_publication(publication)


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _set_publication_subscribed(publication: Any, subscribed: bool) -> None:
    setter = getattr(publication, "set_subscribed", None)
    if callable(setter):
        await _maybe_await(setter(subscribed))
        return
    if hasattr(publication, "subscribed"):
        setattr(publication, "subscribed", subscribed)


def _iter_values(value: Any) -> Iterable[Any]:
    if value is None:
        return ()
    if hasattr(value, "values"):
        return value.values()
    if isinstance(value, dict):
        return value.values()
    return value


class CameraVideoTrackSubscriber:
    """Subscribe to camera video publications and feed their frames onward."""

    def __init__(
        self,
        processor: LatestFrameProcessor[Any, Any],
        *,
        stream_factory: Optional[Callable[[Any], Any]] = None,
    ) -> None:
        self.processor = processor
        self.stream_factory = stream_factory
        self._stream_tasks: set[asyncio.Task[None]] = set()
        self._event_tasks: set[asyncio.Task[Any]] = set()
        self._track_tasks: dict[int, asyncio.Task[None]] = {}
        self._closed = False

    @property
    def active_stream_count(self) -> int:
        return sum(not task.done() for task in self._stream_tasks)

    async def subscribe_publication(self, publication: Any) -> bool:
        if self._closed:
            return False
        if not should_subscribe_to_publication(publication):
            await _set_publication_subscribed(publication, False)
            return False
        await _set_publication_subscribed(publication, True)
        track = getattr(publication, "track", None)
        if track is not None:
            try:
                await self.track_subscribed(track, publication)
            except Exception:
                # Do not leave a publication subscribed when its bounded
                # stream cannot be constructed. The caller still receives
                # the original error for explicit live-mode handling.
                await _set_publication_subscribed(publication, False)
                raise
        return True

    async def track_subscribed(
        self, track: Any, publication: Any = None, participant: Any = None
    ) -> bool:
        del participant
        if self._closed or not is_camera_video_track(track, publication):
            if publication is not None:
                await _set_publication_subscribed(publication, False)
            return False

        track_key = id(track)
        existing = self._track_tasks.get(track_key)
        if existing is not None and not existing.done():
            return True
        stream = await self._make_stream(track)
        task = asyncio.create_task(self._consume_stream(stream), name="camera-video-stream")
        self._stream_tasks.add(task)
        self._track_tasks[track_key] = task

        def forget(done_task: asyncio.Task[None]) -> None:
            self._stream_tasks.discard(done_task)
            if self._track_tasks.get(track_key) is done_task:
                self._track_tasks.pop(track_key, None)

        task.add_done_callback(forget)
        return True

    async def _make_stream(self, track: Any) -> Any:
        if self.stream_factory is not None:
            return await _maybe_await(self.stream_factory(track))
        try:
            from livekit import rtc  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError(
                "livekit.rtc is required for a live camera stream; inject stream_factory for tests"
            ) from error
        video_stream = getattr(rtc, "VideoStream", None)
        if video_stream is None:
            raise RuntimeError("the installed livekit SDK does not provide VideoStream")
        from_track = getattr(video_stream, "from_track", None)
        if callable(from_track):
            return await _maybe_await(from_track(track=track, capacity=1))
        try:
            return video_stream(track=track, capacity=1)
        except TypeError as error:
            raise RuntimeError(
                "the installed livekit SDK cannot create a bounded VideoStream"
            ) from error

    async def _consume_stream(self, stream: AsyncIterable[Any]) -> None:
        try:
            async for event in stream:
                frame = getattr(event, "frame", event)
                await self.processor.submit(frame)
        finally:
            close = getattr(stream, "aclose", None)
            if callable(close):
                await _maybe_await(close())
            else:
                close = getattr(stream, "close", None)
                if callable(close):
                    await _maybe_await(close())

    async def track_unsubscribed(
        self, track: Any, publication: Any = None, participant: Any = None
    ) -> None:
        del publication, participant
        task = self._track_tasks.pop(id(track), None)
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def track_published(self, publication: Any, participant: Any = None) -> bool:
        del participant
        return await self.subscribe_publication(publication)

    async def subscribe_existing_publications(self, room: Any) -> int:
        subscribed = 0
        for participant in _iter_values(getattr(room, "remote_participants", None)):
            for publication in _iter_values(getattr(participant, "track_publications", None)):
                if await self.subscribe_publication(publication):
                    subscribed += 1
        return subscribed

    def attach_room(self, room: Any) -> None:
        on = getattr(room, "on", None)
        if not callable(on):
            return

        def schedule(coroutine: Awaitable[Any]) -> None:
            task = asyncio.create_task(coroutine)
            self._event_tasks.add(task)
            task.add_done_callback(self._event_tasks.discard)

        def handle_subscribed(track: Any, publication: Any, participant: Any) -> None:
            schedule(self.track_subscribed(track, publication, participant))

        def handle_unsubscribed(track: Any, publication: Any, participant: Any) -> None:
            schedule(self.track_unsubscribed(track, publication, participant))
            schedule(_set_publication_subscribed(publication, False))

        def handle_published(publication: Any, participant: Any) -> None:
            schedule(self.track_published(publication, participant))

        for event, callback in (
            ("track_published", handle_published),
            ("track_subscribed", handle_subscribed),
            ("track_unsubscribed", handle_unsubscribed),
        ):
            try:
                on(event, callback)
            except (TypeError, ValueError):
                try:
                    from livekit import rtc  # type: ignore[import-not-found]

                    names = {
                        "track_published": "TrackPublished",
                        "track_subscribed": "TrackSubscribed",
                        "track_unsubscribed": "TrackUnsubscribed",
                    }
                    room_event = getattr(getattr(rtc, "RoomEvent", None), names[event], None)
                    if room_event is not None:
                        on(room_event, callback)
                except ImportError:
                    continue

    async def stop(self) -> None:
        self._closed = True
        tasks = tuple(self._stream_tasks) + tuple(self._event_tasks)
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        close_processor = getattr(self.processor, "aclose", None)
        if callable(close_processor):
            await _maybe_await(close_processor())
        else:
            stop_processor = getattr(self.processor, "stop", None)
            if callable(stop_processor):
                await _maybe_await(stop_processor())

    close = stop


@dataclass
class AgentRuntime:
    room: Any
    subscriber: CameraVideoTrackSubscriber
    current_shot: Shot = "front"
    machine: GuidanceStateMachine | None = None
    publisher: GuidancePacketPublisher | None = None
    _set_shot_callback: Callable[[GuidanceShot], Awaitable[GuidanceStateEvent]] | None = None
    _resync_callback: Callable[[], Awaitable[GuidanceStateEvent]] | None = None
    _control_tasks: set[asyncio.Task[Any]] | None = None
    guidance_transport: GuidanceTransportAdapter | None = None
    _lifecycle_tasks: set[asyncio.Task[Any]] = field(default_factory=set, repr=False)
    _closed: bool = False

    async def set_shot(self, shot: object) -> GuidanceStateEvent | None:
        """Move the session to ``shot`` and publish reliable state."""

        selected = validate_guidance_shot(shot)
        previous = self.current_shot
        self.current_shot = selected.value  # type: ignore[assignment]
        if self.guidance_transport is not None:
            try:
                event = await self.guidance_transport.set_shot(selected)
            except BaseException:
                transport_shot = self.guidance_transport.current_shot
                self.current_shot = (
                    previous
                    if transport_shot is None
                    else transport_shot.value  # type: ignore[assignment]
                )
                raise
            return event

        if self._set_shot_callback is not None:
            return await self._set_shot_callback(selected)
        if self.machine is None or self.publisher is None:
            raise RuntimeError("AgentRuntime has no guidance state publisher")
        event = self.machine.set_shot(selected)
        await self.publisher.publish_state(event)
        return event

    async def resync(self) -> GuidanceStateEvent:
        """Publish the latest reliable session state for a reconnecting client."""

        if self.guidance_transport is not None:
            return await self.guidance_transport.resync()
        if self._resync_callback is not None:
            return await self._resync_callback()
        if self.machine is None or self.publisher is None:
            raise RuntimeError("AgentRuntime has no guidance state publisher")
        event = self.machine.resync()
        await self.publisher.publish_state(event)
        return event

    async def handle_control(self, payload: object) -> bool:
        """Handle a narrowly scoped reliable control message from the browser."""

        raw: object = payload
        if isinstance(raw, (bytes, bytearray, memoryview)):
            try:
                raw = bytes(raw).decode("utf-8")
            except UnicodeDecodeError:
                return False
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                return False
        if not isinstance(raw, dict):
            return False
        message_type = raw.get("type")
        if not isinstance(message_type, str):
            return False
        session_id = (
            self.machine.session_id
            if self.machine is not None
            else self.guidance_transport.session_id
            if self.guidance_transport is not None
            else None
        )
        supplied_session = raw.get("sessionId")
        if session_id is not None and supplied_session is not None and supplied_session != session_id:
            return False
        if message_type == "resync":
            if set(raw) - {"type", "sessionId"}:
                return False
            await self.resync()
            return True
        if message_type in {"set_shot", "shot_changed"}:
            if set(raw) - {"type", "shot", "sessionId"} or "shot" not in raw:
                return False
            try:
                await self.set_shot(raw["shot"])
            except (GuidanceContractError, RuntimeError):
                return False
            return True
        return False

    def attach_control(self) -> None:
        """Listen for browser resync/shot controls without broad subscriptions."""

        on = getattr(self.room, "on", None)
        if not callable(on):
            return
        tasks = self._control_tasks
        if tasks is None:
            tasks = set()
            self._control_tasks = tasks

        def schedule(payload: object) -> None:
            task = asyncio.create_task(self.handle_control(payload))
            tasks.add(task)

            def finish(done_task: asyncio.Task[Any]) -> None:
                tasks.discard(done_task)
                if not done_task.cancelled():
                    # Control packets are untrusted input. Consume failures
                    # here so a disconnected/replaced Room cannot leave an
                    # unhandled task traceback in the Agent logs.
                    done_task.exception()

            task.add_done_callback(finish)

        def handle_data(*args: Any) -> None:
            if args:
                schedule(args[0])

        try:
            on("data_received", handle_data)
        except (TypeError, ValueError):
            try:
                from livekit import rtc  # type: ignore[import-not-found]

                room_event = getattr(getattr(rtc, "RoomEvent", None), "DATA_RECEIVED", None)
                if room_event is not None:
                    on(room_event, handle_data)
            except ImportError:
                return

    async def stop(self) -> None:
        """Release control tasks and all camera/inference resources."""

        await self.close()

    async def close(self) -> None:
        """Fence guidance and release all camera/inference resources."""

        if self._closed:
            return
        self._closed = True
        if self.guidance_transport is not None:
            await self.guidance_transport.close()
        tasks = tuple(self._control_tasks or ())
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        lifecycle_tasks = tuple(self._lifecycle_tasks)
        for task in lifecycle_tasks:
            if task is not asyncio.current_task() and not task.done():
                task.cancel()
        if lifecycle_tasks:
            await asyncio.gather(*lifecycle_tasks, return_exceptions=True)
        await self.subscriber.stop()

    async def mark_disconnected(self) -> bool:
        if self.guidance_transport is None:
            return False
        return await self.guidance_transport.mark_disconnected()

    async def on_reconnected(self) -> GuidanceStateEvent | None:
        if self.guidance_transport is None:
            return None
        publisher = RoomDataPublisher(self.room)
        return await self.guidance_transport.on_reconnected(publisher=publisher)


def _attach_guidance_lifecycle(room: Any, runtime: AgentRuntime) -> None:
    """Fence guidance on Room loss and resync before accepting new frames."""

    on = getattr(room, "on", None)
    if not callable(on) or runtime.guidance_transport is None:
        return

    def schedule(coroutine: Awaitable[Any]) -> None:
        task = asyncio.create_task(coroutine)
        runtime._lifecycle_tasks.add(task)

        def finish(done_task: asyncio.Task[Any]) -> None:
            runtime._lifecycle_tasks.discard(done_task)
            if not done_task.cancelled():
                # Consume lifecycle failures so a transient reconnect does
                # not produce an unhandled-task traceback containing SDK data.
                done_task.exception()

        task.add_done_callback(finish)

    def reconnecting(*_args: Any) -> None:
        schedule(runtime.mark_disconnected())

    def disconnected(*_args: Any) -> None:
        schedule(runtime.mark_disconnected())

    def reconnected(*_args: Any) -> None:
        schedule(runtime.on_reconnected())

    for event, callback in (
        ("reconnecting", reconnecting),
        ("disconnected", disconnected),
        ("reconnected", reconnected),
    ):
        try:
            on(event, callback)
        except (TypeError, ValueError):
            # String events are supported by the current SDK; this fallback
            # keeps the adapter usable with small room fakes as well.
            continue


def session_id_from_room_name(room_name: object) -> str:
    """Recover the browser session id from the token endpoint's room name."""

    if not isinstance(room_name, str) or not room_name.strip():
        raise ValueError("LiveKit room name is required")
    prefix = "listing-photo-session-"
    session_id = room_name[len(prefix) :] if room_name.startswith(prefix) else room_name
    if not session_id:
        raise ValueError("LiveKit room does not contain a session id")
    return session_id


class RoomDataPublisher:
    """SDK-neutral wrapper for a room's local reliable/lossy data publisher."""

    def __init__(self, room: Any, *, topic: str = "guidance") -> None:
        self.room = room
        self.topic = topic

    def publish_data(self, payload: bytes, *, reliable: bool) -> object:
        participant = getattr(self.room, "local_participant", None)
        if participant is None:
            participant = getattr(self.room, "localParticipant", None)
        publish_data = getattr(participant, "publish_data", None)
        if not callable(publish_data):
            publish_data = getattr(participant, "publishData", None)
        if not callable(publish_data):
            raise RuntimeError("LiveKit room has no local data publisher")
        try:
            return publish_data(
                payload,
                reliable=reliable,
                topic=self.topic,
            )
        except TypeError:
            # Older LiveKit versions do not expose the topic keyword.
            return publish_data(payload, reliable=reliable)


class GuidancePacketPublisher:
    """Publish validated guidance and reliable state packets.

    Guidance packets are intentionally lossy: a newer message supersedes an
    older one.  Shot transitions and resync snapshots use a separate reliable
    method so a client can recover after a lossy packet is missed.
    """

    def __init__(
        self,
        room: Any,
        *,
        topic: str = "guidance",
        clock: Callable[[], int] | None = None,
    ) -> None:
        self.room = room
        self.topic = topic
        self._clock = clock
        self._publish_lock: asyncio.Lock | None = None
        self._last_sequence = 0

    def _lock(self) -> asyncio.Lock:
        if self._publish_lock is None:
            self._publish_lock = asyncio.Lock()
        return self._publish_lock

    async def _publish_event(self, event: GuidanceEvent | GuidanceStateEvent) -> None:
        """Encode a state-machine event before it reaches the data channel."""

        encoded = encode_guidance_event(event)
        result = RoomDataPublisher(self.room, topic=self.topic).publish_data(
            encoded,
            reliable=isinstance(event, GuidanceStateEvent),
        )
        await _maybe_await(result)

    async def publish(self, event: GuidanceEvent) -> bool:
        """Publish a lossy guidance event unless an injected clock sees it expired."""

        if not isinstance(event, GuidanceEvent):
            raise TypeError("publish requires a GuidanceEvent")
        async with self._lock():
            if event.sequence <= self._last_sequence:
                return False
            if self._clock is not None and event.is_expired(self._clock()):
                return False
            await self._publish_event(event)
            self._last_sequence = event.sequence
            return True

    async def publish_state(self, event: GuidanceStateEvent) -> bool:
        """Publish a reliable shot-change or resync state event."""

        if not isinstance(event, GuidanceStateEvent):
            raise TypeError("publish_state requires a GuidanceStateEvent")
        async with self._lock():
            if event.sequence <= self._last_sequence:
                return False
            await self._publish_event(event)
            self._last_sequence = event.sequence
            return True


async def _encode_frame_for_guidance(frame: Any) -> bytes:
    if isinstance(frame, (bytes, bytearray, memoryview)):
        encoded = bytes(frame)
        if encoded:
            return encoded
        raise ValueError("LiveKit frame cannot be encoded for guidance")
    for name in ("to_jpeg", "to_jpeg_bytes", "encode_jpeg"):
        encoder = getattr(frame, name, None)
        if callable(encoder):
            encoded = await _maybe_await(encoder())
            if isinstance(encoded, (bytes, bytearray, memoryview)) and encoded:
                return bytes(encoded)
    data = getattr(frame, "data", None)
    if isinstance(data, (bytes, bytearray, memoryview)) and data:
        return bytes(data)
    raise ValueError("LiveKit frame cannot be encoded for guidance")


def _provider_mode(settings: BackendSettings) -> str:
    raw_mode = getattr(settings, "provider_mode", "fixture")
    mode = getattr(raw_mode, "value", raw_mode)
    if not isinstance(mode, str):
        raise ValueError("provider_mode must be fixture or live")
    return mode.strip().lower()


def _resolve_requested_shot(
    requested_shot: GuidanceShot | str | Callable[[], GuidanceShot | str],
) -> GuidanceShot:
    value = requested_shot() if callable(requested_shot) else requested_shot
    return validate_guidance_shot(value)


@dataclass(frozen=True, slots=True)
class _BoundInferenceResult:
    shot: GuidanceShot
    value: Any


class _BoundInferenceError(RuntimeError):
    """Keep the shot associated with an exception from a slow inference."""

    def __init__(self, shot: GuidanceShot, original: BaseException) -> None:
        super().__init__(str(original))
        self.shot = shot
        self.original = original


def create_default_guidance_inference(
    settings: BackendSettings | None = None,
    *,
    requested_shot: GuidanceShot
    | str
    | Callable[[], GuidanceShot | str] = GuidanceShot.FRONT,
    provider: VisionGuidanceProvider | None = None,
    live_analyzer: LiveVisionAnalyzer | None = None,
) -> Inference[Any, VisionDecision]:
    """Build an explicit fixture/live vision inference boundary.

    ``provider`` or ``live_analyzer`` is the injection point for the parent
    integration's concrete live vision implementation.  In live mode, a
    missing injection raises from the provider; it is never changed to a
    fixture implementation.
    """

    selected = settings or BackendSettings.from_env()
    mode = _provider_mode(selected)
    if mode == "fixture":
        if provider is not None or live_analyzer is not None:
            raise ValueError("live provider injection is not allowed in fixture mode")
        selected_provider: VisionGuidanceProvider = FixtureVisionGuidanceProvider()
    elif mode == "live":
        if provider is not None and live_analyzer is not None:
            raise TypeError("provide provider or live_analyzer, not both")
        selected_provider = (
            provider
            if isinstance(provider, LiveVisionGuidanceProvider)
            else LiveVisionGuidanceProvider(
                provider=provider,
                analyzer=live_analyzer,
            )
        )
    else:
        raise ValueError("provider_mode must be fixture or live")

    async def infer(frame: Any) -> VisionDecision:
        encoded = await _encode_frame_for_guidance(frame)
        return validate_vision_decision(
            await selected_provider.analyze(
                GuidanceInput(
                    frame=EncodedImage(encoded),
                    requested_shot=_resolve_requested_shot(requested_shot),
                )
            )
        )

    return infer


def _auto_subscribe_none() -> Any:
    try:
        from livekit.agents import AutoSubscribe  # type: ignore[import-not-found]

        value = getattr(AutoSubscribe, "SUBSCRIBE_NONE", None)
        if value is not None:
            return value
    except ImportError:
        pass
    return "subscribe_none"


async def connect_agent_context(ctx: Any) -> Any:
    connect = getattr(ctx, "connect", None)
    if not callable(connect):
        raise RuntimeError("LiveKit Agent context does not provide connect()")
    try:
        await _maybe_await(connect(auto_subscribe=_auto_subscribe_none()))
    except TypeError as error:
        raise RuntimeError(
            "LiveKit context must support explicit SUBSCRIBE_NONE; refusing an implicit policy"
        ) from error
    room = getattr(ctx, "room", None)
    if room is None:
        raise RuntimeError("LiveKit Agent context has no room after connect")
    return room


async def start_agent_runtime(
    ctx: Any,
    inference: Optional[Inference[Any, Any]] = None,
    *,
    on_result: Optional[ResultSink[Any, Any]] = None,
    on_error: Optional[ErrorSink] = None,
    stream_factory: Optional[Callable[[Any], Any]] = None,
    settings: BackendSettings | None = None,
    provider: VisionGuidanceProvider | None = None,
    live_analyzer: LiveVisionAnalyzer | None = None,
    requested_shot: GuidanceShot | str = GuidanceShot.FRONT,
    cadence_seconds: float | None = None,
    guidance_ttl_ms: int = 2_000,
    transport_factory: GuidanceTransportFactory | None = None,
    max_inference_calls: int | None = None,
    failure_cooldown_seconds: float | None = None,
) -> AgentRuntime:
    resolved_settings = settings or BackendSettings.from_env()
    selected_cadence = (
        getattr(resolved_settings, "guidance_cadence_seconds", DEFAULT_GUIDANCE_CADENCE_SECONDS)
        if cadence_seconds is None
        else cadence_seconds
    )
    selected_max_calls = (
        getattr(
            resolved_settings,
            "guidance_max_calls_per_session",
            DEFAULT_GUIDANCE_MAX_CALLS_PER_SESSION,
        )
        if max_inference_calls is None
        else max_inference_calls
    )
    selected_failure_cooldown = (
        getattr(
            resolved_settings,
            "guidance_failure_cooldown_seconds",
            DEFAULT_GUIDANCE_FAILURE_COOLDOWN_SECONDS,
        )
        if failure_cooldown_seconds is None
        else failure_cooldown_seconds
    )
    room = await connect_agent_context(ctx)

    # The current Team-D transport is intentionally selected by the worker
    # entrypoint.  Keep the older direct publisher path below for embedded
    # callers that have not supplied a transport factory yet.
    if transport_factory is not None:
        active_shot = _resolve_requested_shot(requested_shot)
        selected_inference = inference
        if selected_inference is None:
            selected_inference = create_default_guidance_inference(
                resolved_settings,
                requested_shot=lambda: active_shot,
                provider=provider,
                live_analyzer=live_analyzer,
            )
        runtime_holder: dict[str, AgentRuntime] = {}
        transport_holder: dict[str, GuidanceTransportAdapter | None] = {"value": None}

        async def process_frame(frame: Any) -> Any:
            transport = transport_holder["value"]
            if transport is None:
                result = selected_inference(frame)
                return await _maybe_await(result)
            return await transport.process_frame(
                frame,
                shot=runtime_holder["value"].current_shot,
            )

        processor = LatestFrameProcessor(
            process_frame,
            on_result=on_result,
            on_error=on_error,
            min_interval_seconds=selected_cadence,
            max_inference_calls=selected_max_calls,
            failure_cooldown_seconds=selected_failure_cooldown,
        )
        subscriber = CameraVideoTrackSubscriber(processor, stream_factory=stream_factory)
        subscriber.attach_room(room)
        runtime = AgentRuntime(
            room=room,
            subscriber=subscriber,
            current_shot=active_shot.value,  # type: ignore[arg-type]
        )
        runtime_holder["value"] = runtime
        try:
            transport = transport_factory(room, lambda: runtime.current_shot)
        except BaseException:
            await runtime.close()
            raise
        if not isinstance(transport, GuidanceTransportAdapter):
            await runtime.close()
            raise TypeError("transport_factory must return GuidanceTransportAdapter")
        transport_holder["value"] = transport
        runtime.guidance_transport = transport
        runtime.attach_control()
        _attach_guidance_lifecycle(room, runtime)

        add_shutdown_callback = getattr(ctx, "add_shutdown_callback", None)
        if callable(add_shutdown_callback):

            async def shutdown_callback(*_args: Any) -> None:
                await runtime.close()

            await _maybe_await(add_shutdown_callback(shutdown_callback))
        try:
            await subscriber.subscribe_existing_publications(room)
        except Exception:
            await runtime.close()
            raise
        return runtime

    session_id = session_id_from_room_name(getattr(room, "name", None))
    machine = GuidanceStateMachine(session_id, guidance_ttl_ms=guidance_ttl_ms)
    active_shot = _resolve_requested_shot(requested_shot)
    publisher = GuidancePacketPublisher(room, clock=machine.now_ms)
    selected_inference = inference
    if selected_inference is None:
        selected_inference = create_default_guidance_inference(
            resolved_settings,
            requested_shot=lambda: active_shot,
            provider=provider,
            live_analyzer=live_analyzer,
        )

    async def run_selected_inference(frame: Any) -> _BoundInferenceResult:
        shot = active_shot
        try:
            result = selected_inference(frame)
            if inspect.isawaitable(result):
                result = await result
        except asyncio.CancelledError:
            raise
        except Exception as error:
            raise _BoundInferenceError(shot, error) from error
        return _BoundInferenceResult(shot, result)

    async def publish_result(result: Any, frame: Any) -> None:
        result_shot = active_shot
        raw_result = result
        if isinstance(result, _BoundInferenceResult):
            result_shot = result.shot
            raw_result = result.value
            if result_shot is not active_shot:
                # A slow provider returned after a shot transition. It is
                # still observable through the callback, but cannot emit a
                # packet for the new shot or rewind the state machine.
                if on_result is not None:
                    callback_result = on_result(raw_result, frame)
                    if inspect.isawaitable(callback_result):
                        await callback_result
                return
        try:
            decision = validate_vision_decision(raw_result)
            event = machine.emit(result_shot, decision)
            if event is not None:
                await publisher.publish(event)
        except Exception:
            # A custom inference callback may return an application-specific
            # value. Preserve the callback contract without emitting an
            # unvalidated packet.
            pass
        if on_result is not None:
            callback_result = on_result(raw_result, frame)
            if inspect.isawaitable(callback_result):
                await callback_result

    async def publish_error(error: BaseException, frame: Any) -> None:
        error_shot = active_shot
        raw_error = error
        if isinstance(error, _BoundInferenceError):
            error_shot = error.shot
            raw_error = error.original
        if error_shot is not active_shot:
            if on_error is not None:
                callback_error = on_error(raw_error, frame)
                if inspect.isawaitable(callback_error):
                    await callback_error
            return
        try:
            event = machine.emit(
                error_shot,
                VisionDecision(GuidanceCode.AGENT_UNAVAILABLE, 0.0),
            )
            if event is not None:
                await publisher.publish(event)
        except Exception:
            pass
        if on_error is not None:
            callback_error = on_error(raw_error, frame)
            if inspect.isawaitable(callback_error):
                await callback_error

    processor = LatestFrameProcessor(
        run_selected_inference,
        on_result=publish_result,
        on_error=publish_error,
        min_interval_seconds=selected_cadence,
        max_inference_calls=selected_max_calls,
        failure_cooldown_seconds=selected_failure_cooldown,
    )
    subscriber = CameraVideoTrackSubscriber(processor, stream_factory=stream_factory)
    subscriber.attach_room(room)

    async def set_active_shot(shot: GuidanceShot) -> GuidanceStateEvent:
        nonlocal active_shot
        event = machine.set_shot(shot)
        active_shot = shot
        runtime.current_shot = shot.value  # type: ignore[assignment]
        await publisher.publish_state(event)
        return event

    async def publish_resync() -> GuidanceStateEvent:
        event = machine.resync()
        await publisher.publish_state(event)
        return event

    runtime = AgentRuntime(
        room=room,
        subscriber=subscriber,
        current_shot=active_shot.value,  # type: ignore[arg-type]
        machine=machine,
        publisher=publisher,
        _set_shot_callback=set_active_shot,
        _resync_callback=publish_resync,
    )
    runtime.attach_control()
    add_shutdown_callback = getattr(ctx, "add_shutdown_callback", None)
    if callable(add_shutdown_callback):

        async def shutdown_callback(*_args: Any) -> None:
            await runtime.stop()

        await _maybe_await(add_shutdown_callback(shutdown_callback))
    try:
        await subscriber.subscribe_existing_publications(room)
    except Exception:
        await runtime.stop()
        raise
    return runtime


async def entrypoint(
    ctx: Any,
    *,
    inference: Optional[Inference[Any, Any]] = None,
    on_result: Optional[ResultSink[Any, Any]] = None,
    on_error: Optional[ErrorSink] = None,
    stream_factory: Optional[Callable[[Any], Any]] = None,
    settings: BackendSettings | None = None,
    provider: VisionGuidanceProvider | None = None,
    live_analyzer: LiveVisionAnalyzer | None = None,
    requested_shot: GuidanceShot | str = GuidanceShot.FRONT,
    cadence_seconds: float | None = None,
    guidance_ttl_ms: int = 2_000,
    transport_factory: GuidanceTransportFactory | None = None,
    max_inference_calls: int | None = None,
    failure_cooldown_seconds: float | None = None,
) -> AgentRuntime:
    runtime = await start_agent_runtime(
        ctx,
        inference,
        on_result=on_result,
        on_error=on_error,
        stream_factory=stream_factory,
        settings=settings,
        provider=provider,
        live_analyzer=live_analyzer,
        requested_shot=requested_shot,
        cadence_seconds=cadence_seconds,
        guidance_ttl_ms=guidance_ttl_ms,
        transport_factory=transport_factory,
        max_inference_calls=max_inference_calls,
        failure_cooldown_seconds=failure_cooldown_seconds,
    )
    wait_for_shutdown = getattr(ctx, "wait_for_shutdown", None)
    if callable(wait_for_shutdown):
        try:
            await _maybe_await(wait_for_shutdown())
        finally:
            await runtime.stop()
    return runtime


def create_agent_server(
    *,
    inference: Optional[Inference[Any, Any]] = None,
    on_result: Optional[ResultSink[Any, Any]] = None,
    on_error: Optional[ErrorSink] = None,
    transport_factory: GuidanceTransportFactory | None = None,
    settings: BackendSettings | None = None,
) -> Any:
    try:
        from livekit.agents import AgentServer  # type: ignore[import-not-found]
    except ImportError:
        return None
    server = AgentServer()
    register = getattr(server, "rtc_session", None)
    if not callable(register):
        raise RuntimeError("the installed livekit-agents SDK does not provide rtc_session")
    resolved_settings = settings or BackendSettings.from_env()

    @register()
    async def live_session(ctx: Any) -> AgentRuntime:
        return await entrypoint(
            ctx,
            inference=inference,
            on_result=on_result,
            on_error=on_error,
            transport_factory=transport_factory,
            settings=resolved_settings,
        )

    return server


def main() -> None:
    settings = BackendSettings.from_env()
    logging.basicConfig(level=logging.INFO)
    logging.getLogger(__name__).info(
        "assistant_agent_starting provider_mode=%s provider_schema=VisionGuidanceProvider",
        settings.provider_mode,
    )
    try:
        from livekit.agents import cli  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError(
            "livekit-agents is required to run the Agent; install the locked Python dependencies"
        ) from error
    server = create_agent_server(settings=settings)
    if server is None:
        raise RuntimeError("unable to create the LiveKit Agent server")
    cli.run_app(server)


LatestFrameQueue = LatestFrameSlot
FrameProcessor = LatestFrameProcessor
CameraTrackSubscriber = CameraVideoTrackSubscriber
run_agent = entrypoint


__all__ = [
    "AgentRuntime",
    "CameraTrackSubscriber",
    "CameraVideoTrackSubscriber",
    "FrameProcessor",
    "FrameSlotClosed",
    "InferenceBudgetExceeded",
    "GuidancePacketPublisher",
    "GuidanceTransportFactory",
    "LatestFrameProcessor",
    "LatestFrameQueue",
    "LatestFrameSlot",
    "RoomDataPublisher",
    "Shot",
    "connect_agent_context",
    "create_default_guidance_inference",
    "create_agent_server",
    "entrypoint",
    "is_camera_source",
    "is_camera_video_publication",
    "is_camera_video_track",
    "is_video_kind",
    "main",
    "run_agent",
    "session_id_from_room_name",
    "should_subscribe_to_publication",
    "start_agent_runtime",
]


if __name__ == "__main__":  # pragma: no cover
    main()
