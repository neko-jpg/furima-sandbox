"""SDK-independent delivery of finite live-guidance events.

The state machine owns the public guidance state.  This adapter is the small
boundary between an Agent inference callback and a LiveKit-compatible data
publisher.  It never accepts provider-provided UI copy: every guidance
message comes from the state machine's fixed mapping.

The publisher is deliberately structural rather than a LiveKit SDK type.  A
``LocalParticipant`` can be passed directly in production, while tests can
use an in-memory object with ``publish_data``.  Both synchronous and
asynchronous publisher implementations are supported.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from math import isfinite
from typing import Protocol, TypeAlias, runtime_checkable

from .guidance_state_machine import (
    GUIDANCE_MESSAGES,
    GuidanceEvent,
    GuidanceStateEvent,
    GuidanceStateMachine,
)
from .providers.runtime import ProviderInference
from .providers.vision_guidance import (
    GuidanceShot,
    validate_guidance_shot,
    validate_vision_decision,
)


class GuidanceTransportError(RuntimeError):
    """Raised when an event cannot be safely put on the data channel."""


@runtime_checkable
class DataPublisher(Protocol):
    """Minimal common surface of a LiveKit data-channel publisher."""

    def publish_data(self, payload: bytes, *, reliable: bool) -> object:
        """Publish bytes, returning either a value or an awaitable value."""


Event: TypeAlias = GuidanceEvent | GuidanceStateEvent

_GUIDANCE_FIELDS = frozenset(
    {
        "sessionId",
        "sequence",
        "shot",
        "code",
        "message",
        "confidence",
        "observedAt",
        "expiresAt",
    }
)
_STATE_FIELDS = frozenset(
    {"type", "sessionId", "sequence", "shot", "code", "observedAt"}
)


def _finite_json(value: object) -> bool:
    """Return whether ``value`` is made solely of finite JSON primitives."""

    if value is None or isinstance(value, (str, bool)):
        return True
    if isinstance(value, int) and not isinstance(value, bool):
        return True
    if isinstance(value, float):
        return isfinite(value)
    if isinstance(value, list):
        return all(_finite_json(item) for item in value)
    if isinstance(value, dict):
        return all(
            isinstance(key, str) and _finite_json(item)
            for key, item in value.items()
        )
    return False


def encode_guidance_event(event: Event) -> bytes:
    """Encode a closed, finite wire payload for one state-machine event."""

    if isinstance(event, GuidanceEvent):
        if event.message != GUIDANCE_MESSAGES[event.code]:
            raise GuidanceTransportError(
                "guidance message must be state-machine generated"
            )
        payload = event.to_payload()
        expected_fields = _GUIDANCE_FIELDS
    elif isinstance(event, GuidanceStateEvent):
        payload = event.to_payload()
        expected_fields = _STATE_FIELDS
    else:
        raise GuidanceTransportError(
            "event must be a GuidanceEvent or GuidanceStateEvent"
        )

    if set(payload) != expected_fields or not _finite_json(payload):
        raise GuidanceTransportError("event payload must have a finite closed shape")
    try:
        return json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise GuidanceTransportError(
            "event payload is not JSON serializable"
        ) from error


class GuidanceTransportAdapter:
    """Validate inference, update session state, and publish its events.

    ``mark_disconnected`` fences all work started on the old Room.
    ``on_reconnected`` sends a reliable snapshot and only enables inference
    after that publication succeeds.  Inference is intentionally performed
    outside the state lock so a disconnect, shot change, or close can fence an
    in-flight model result immediately.
    """

    def __init__(
        self,
        inference: ProviderInference,
        publisher: DataPublisher,
        *,
        session_id: str | None = None,
        state_machine: GuidanceStateMachine | None = None,
    ) -> None:
        if not callable(inference):
            raise TypeError("inference must be callable")
        if not callable(getattr(publisher, "publish_data", None)):
            raise TypeError("publisher must provide publish_data")
        if state_machine is None:
            if session_id is None:
                raise TypeError("session_id is required when state_machine is not supplied")
            state_machine = GuidanceStateMachine(session_id)
        elif session_id is not None and session_id != state_machine.session_id:
            raise GuidanceTransportError("session_id does not match state_machine")

        self._inference = inference
        self._publisher = publisher
        self._state_machine = state_machine
        self._shot: GuidanceShot | None = None
        self._connected = True
        self._closed = False
        self._connection_generation = 0
        self._shot_generation = 0
        self._frame_generation = 0
        self._lock = asyncio.Lock()

    @property
    def session_id(self) -> str:
        return self._state_machine.session_id

    @property
    def current_shot(self) -> GuidanceShot | None:
        return self._shot

    @property
    def sequence(self) -> int:
        return self._state_machine.sequence

    @property
    def connected(self) -> bool:
        return self._connected and not self._closed

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def connection_generation(self) -> int:
        return self._connection_generation

    def _require_active(self) -> None:
        if self._closed:
            raise GuidanceTransportError("guidance session is closed")
        if not self._connected:
            raise GuidanceTransportError(
                "guidance transport is disconnected; call on_reconnected first"
            )

    @staticmethod
    def _validate_publisher(publisher: object) -> DataPublisher:
        if not callable(getattr(publisher, "publish_data", None)):
            raise TypeError("publisher must provide publish_data")
        return publisher  # type: ignore[return-value]

    async def _publish(self, event: Event, *, allow_disconnected: bool = False) -> Event:
        if not allow_disconnected:
            self._require_active()
        reliable = isinstance(event, GuidanceStateEvent)
        try:
            payload = encode_guidance_event(event)
            result = self._publisher.publish_data(payload, reliable=reliable)
            if inspect.isawaitable(result):
                await result
        except BaseException:
            if reliable:
                # A failed reliable packet leaves peer state unknown.  The
                # sequence has already been allocated, so fence this Room and
                # require a successful reliable resync before later advice.
                self._connected = False
                self._connection_generation += 1
                self._frame_generation += 1
            raise
        return event

    async def set_shot(
        self,
        shot: object,
        *,
        observed_at: object | None = None,
    ) -> GuidanceStateEvent | None:
        """Publish reliable shot state only when the selected shot changes."""

        shot_value = validate_guidance_shot(shot)
        async with self._lock:
            self._require_active()
            if shot_value == self._shot:
                return None
            event = self._state_machine.set_shot(shot_value, observed_at=observed_at)
            self._shot = shot_value
            self._shot_generation += 1
            return await self._publish(event)  # type: ignore[return-value]

    async def resync(self, *, observed_at: object | None = None) -> GuidanceStateEvent:
        """Publish the current state as a reliable resynchronization."""

        async with self._lock:
            self._require_active()
            return await self._publish(
                self._state_machine.resync(observed_at=observed_at)
            )  # type: ignore[return-value]

    snapshot = resync

    async def mark_disconnected(self) -> bool:
        """Fence the current Room and suppress future publication."""

        async with self._lock:
            if self._closed or not self._connected:
                return False
            self._connected = False
            self._connection_generation += 1
            self._frame_generation += 1
            return True

    async def on_reconnected(
        self,
        *,
        publisher: DataPublisher | None = None,
        observed_at: object | None = None,
    ) -> GuidanceStateEvent:
        """Publish a reliable snapshot before permitting new guidance."""

        async with self._lock:
            if self._closed:
                raise GuidanceTransportError("guidance session is closed")
            if self._connected:
                raise GuidanceTransportError("guidance transport is already connected")
            if publisher is not None:
                self._publisher = self._validate_publisher(publisher)
            self._connection_generation += 1
            event = self._state_machine.resync(observed_at=observed_at)
            await self._publish(event, allow_disconnected=True)
            self._connected = True
            return event

    async def close(self) -> bool:
        """End this non-persistent session and fence in-flight inference."""

        async with self._lock:
            if self._closed:
                return False
            self._closed = True
            self._connected = False
            self._connection_generation += 1
            self._frame_generation += 1
            return True

    async def process_frame(
        self,
        frame: object,
        *,
        shot: object,
        observed_at: object | None = None,
    ) -> GuidanceEvent | None:
        """Infer and publish one lossy finite advice event."""

        shot_value = validate_guidance_shot(shot)
        async with self._lock:
            self._require_active()
            if shot_value != self._shot:
                state_event = self._state_machine.set_shot(
                    shot_value, observed_at=observed_at
                )
                self._shot = shot_value
                self._shot_generation += 1
                await self._publish(state_event)
            self._frame_generation += 1
            connection_generation = self._connection_generation
            shot_generation = self._shot_generation
            frame_generation = self._frame_generation

        raw_result = self._inference(frame)
        if inspect.isawaitable(raw_result):
            raw_result = await raw_result

        async with self._lock:
            if (
                self._closed
                or not self._connected
                or connection_generation != self._connection_generation
                or shot_generation != self._shot_generation
                or frame_generation != self._frame_generation
                or shot_value != self._shot
            ):
                return None
            decision = validate_vision_decision(raw_result)
            event = self._state_machine.emit(
                shot_value,
                decision,
                observed_at=observed_at,
            )
            if event is None:
                return None
            return await self._publish(event)  # type: ignore[return-value]

    handle_frame = process_frame


GuidanceTransport = GuidanceTransportAdapter
LiveKitGuidanceTransport = GuidanceTransportAdapter


__all__ = [
    "DataPublisher",
    "Event",
    "GuidanceTransport",
    "GuidanceTransportAdapter",
    "GuidanceTransportError",
    "LiveKitGuidanceTransport",
    "encode_guidance_event",
]
