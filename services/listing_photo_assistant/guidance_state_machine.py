"""Finite, ordered live guidance events independent of transport SDKs.

The state machine owns ordering, deduplication, expiry, and shot-generation
checks.  Transport adapters can therefore map lossy guidance events and
reliable state events onto LiveKit (or a test double) without putting SDK
details into the provider contract.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import Enum
from math import isfinite
from typing import TypeAlias

from .providers.vision_guidance import (
    GuidanceCode,
    GuidanceContractError,
    GuidanceInput,
    GuidanceShot,
    VisionGuidanceProvider,
    validate_guidance_input,
    validate_guidance_shot,
    validate_vision_decision,
)


GuidanceValidationError = GuidanceContractError


class TransportKind(str, Enum):
    LOSSY = "lossy"
    RELIABLE = "reliable"


GUIDANCE_MESSAGES: Mapping[GuidanceCode, str] = {
    GuidanceCode.MOVE_CLOSER: "カメラを少し近づけてください。",
    GuidanceCode.MOVE_FARTHER: "カメラを少し離してください。",
    GuidanceCode.CENTER_GARMENT: "衣類をガイドの中央に合わせてください。",
    GuidanceCode.SHOW_FULL_GARMENT: "衣類全体が入るようにカメラを離してください。",
    GuidanceCode.WRONG_SIDE: "衣類を裏返して、指定された面を見せてください。",
    GuidanceCode.MOVE_TO_TAG: "タグが見える位置へ移動してください。",
    GuidanceCode.PLACE_MARKER: "専用マーカーを衣類の右下に置いてください。",
    GuidanceCode.MARKER_NOT_VISIBLE: "専用マーカー全体が見えるようにしてください。",
    GuidanceCode.FLATTEN_GARMENT: "襟、袖、裾を広げて、しわを伸ばしてください。",
    GuidanceCode.CAMERA_OVERHEAD: "カメラを衣類の真上に構えてください。",
    GuidanceCode.HOLD_STEADY: "カメラを動かさず、そのまま保ってください。",
    GuidanceCode.READY: "撮影できます。",
    GuidanceCode.AGENT_UNAVAILABLE: "ライブ案内を利用できません。固定ガイドで撮影できます。",
}


def _non_empty(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GuidanceContractError(f"{field} must be a non-empty string")
    return value


def _timestamp(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise GuidanceContractError(f"{field} must be a finite timestamp")
    converted = float(value)
    if not isfinite(converted) or converted < 0 or not converted.is_integer():
        raise GuidanceContractError(f"{field} must be a non-negative integer timestamp")
    return int(converted)


@dataclass(frozen=True, slots=True)
class GuidanceEvent:
    session_id: str
    sequence: int
    shot: GuidanceShot
    code: GuidanceCode
    message: str
    confidence: float
    observed_at: int
    expires_at: int
    transport: TransportKind = TransportKind.LOSSY

    def __post_init__(self) -> None:
        object.__setattr__(self, "session_id", _non_empty(self.session_id, "sessionId"))
        if isinstance(self.sequence, bool) or not isinstance(self.sequence, int) or self.sequence < 1:
            raise GuidanceContractError("sequence must be a positive integer")
        object.__setattr__(self, "shot", validate_guidance_shot(self.shot))
        decision = validate_vision_decision({"code": self.code, "confidence": self.confidence})
        object.__setattr__(self, "code", decision.code)
        object.__setattr__(self, "confidence", decision.confidence)
        object.__setattr__(self, "message", _non_empty(self.message, "message"))
        observed_at = _timestamp(self.observed_at, "observedAt")
        expires_at = _timestamp(self.expires_at, "expiresAt")
        if expires_at <= observed_at:
            raise GuidanceContractError("expiresAt must be later than observedAt")
        object.__setattr__(self, "observed_at", observed_at)
        object.__setattr__(self, "expires_at", expires_at)
        if self.transport is not TransportKind.LOSSY:
            raise GuidanceContractError("guidance events must use lossy transport")

    @property
    def sessionId(self) -> str:
        return self.session_id

    @property
    def observedAt(self) -> int:
        return self.observed_at

    @property
    def expiresAt(self) -> int:
        return self.expires_at

    def is_expired(self, now_ms: int) -> bool:
        return _timestamp(now_ms, "now") >= self.expires_at

    def is_stale(
        self,
        now_ms: object,
        *,
        session_id: object | None = None,
        last_sequence: object | None = None,
        expected_shot: object | None = None,
    ) -> bool:
        """Return whether a received event must be discarded.

        The browser already performs this check, but keeping the predicate on
        the transport-independent event makes server-side adapters and tests
        apply the same policy.  ``last_sequence`` is the last sequence seen
        across both lossy and reliable packets, so a delayed packet cannot
        move a consumer backwards.
        """

        if session_id is not None and self.session_id != _non_empty(session_id, "sessionId"):
            return True
        if last_sequence is not None:
            if (
                isinstance(last_sequence, bool)
                or not isinstance(last_sequence, int)
                or last_sequence < 0
            ):
                raise GuidanceContractError("last_sequence must be a non-negative integer")
            if self.sequence <= last_sequence:
                return True
        if expected_shot is not None and self.shot is not validate_guidance_shot(expected_shot):
            return True
        return self.is_expired(_timestamp(now_ms, "now"))

    def to_payload(self) -> dict[str, object]:
        return {
            "sessionId": self.session_id,
            "sequence": self.sequence,
            "shot": self.shot.value,
            "code": self.code.value,
            "message": self.message,
            "confidence": self.confidence,
            "observedAt": self.observed_at,
            "expiresAt": self.expires_at,
        }


@dataclass(frozen=True, slots=True)
class GuidanceStateEvent:
    """Reliable current-shot state used for transition and resync."""

    session_id: str
    sequence: int
    kind: str
    shot: GuidanceShot | None
    code: GuidanceCode | None
    observed_at: int
    transport: TransportKind = TransportKind.RELIABLE

    def __post_init__(self) -> None:
        object.__setattr__(self, "session_id", _non_empty(self.session_id, "sessionId"))
        if isinstance(self.sequence, bool) or not isinstance(self.sequence, int) or self.sequence < 1:
            raise GuidanceContractError("sequence must be a positive integer")
        if self.kind not in {"shot_changed", "resync"}:
            raise GuidanceContractError("state kind must be shot_changed or resync")
        if self.shot is not None:
            object.__setattr__(self, "shot", validate_guidance_shot(self.shot))
        if self.code is not None:
            object.__setattr__(
                self,
                "code",
                validate_vision_decision({"code": self.code, "confidence": 1.0}).code,
            )
        object.__setattr__(self, "observed_at", _timestamp(self.observed_at, "observedAt"))
        if self.transport is not TransportKind.RELIABLE:
            raise GuidanceContractError("state events must use reliable transport")

    def to_payload(self) -> dict[str, object]:
        return {
            "type": self.kind,
            "sessionId": self.session_id,
            "sequence": self.sequence,
            "shot": None if self.shot is None else self.shot.value,
            "code": None if self.code is None else self.code.value,
            "observedAt": self.observed_at,
        }

    def is_stale(
        self,
        *,
        session_id: object | None = None,
        last_sequence: object | None = None,
        expected_shot: object | None = None,
    ) -> bool:
        """Return whether a reliable state packet is older than local state."""

        if session_id is not None and self.session_id != _non_empty(session_id, "sessionId"):
            return True
        if last_sequence is not None:
            if (
                isinstance(last_sequence, bool)
                or not isinstance(last_sequence, int)
                or last_sequence < 0
            ):
                raise GuidanceContractError("last_sequence must be a non-negative integer")
            if self.sequence <= last_sequence:
                return True
        if expected_shot is not None:
            expected = validate_guidance_shot(expected_shot)
            if self.shot is not expected:
                return True
        return False


Clock: TypeAlias = Callable[[], int]


class GuidanceStateMachine:
    """Allocate monotonic sequences and deduplicate guidance per session."""

    def __init__(
        self,
        session_id: str,
        *,
        clock: Clock | None = None,
        guidance_ttl_ms: int = 2_000,
    ) -> None:
        self._session_id = _non_empty(session_id, "sessionId")
        self._clock = clock or (lambda: int(time.time() * 1_000))
        if isinstance(guidance_ttl_ms, bool) or not isinstance(guidance_ttl_ms, int) or guidance_ttl_ms <= 0:
            raise GuidanceContractError("guidance_ttl_ms must be a positive integer")
        self._guidance_ttl_ms = guidance_ttl_ms
        self._sequence = 0
        self._shot: GuidanceShot | None = None
        self._code: GuidanceCode | None = None
        self._last_key: tuple[GuidanceShot, GuidanceCode] | None = None
        self._last_guidance_expires_at: int | None = None
        self._shot_generation = 0

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def sequence(self) -> int:
        return self._sequence

    @property
    def current_shot(self) -> GuidanceShot | None:
        return self._shot

    @property
    def current_code(self) -> GuidanceCode | None:
        return self._code

    @property
    def last_guidance_expires_at(self) -> int | None:
        return self._last_guidance_expires_at

    @property
    def guidance_ttl_ms(self) -> int:
        return self._guidance_ttl_ms

    def now_ms(self) -> int:
        """Read the configured clock in the same unit as event timestamps."""

        return self._now()

    def _now(self, value: object | None = None) -> int:
        return _timestamp(self._clock() if value is None else value, "observedAt")

    def _next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence

    def emit(
        self,
        shot: object,
        decision: object,
        *,
        observed_at: object | None = None,
    ) -> GuidanceEvent | None:
        shot_value = validate_guidance_shot(shot)
        decision_value = validate_vision_decision(decision)
        now = self._now(observed_at)
        key = (shot_value, decision_value.code)
        if key == self._last_key:
            return None
        shot_changed = shot_value is not self._shot
        event = GuidanceEvent(
            session_id=self._session_id,
            sequence=self._next_sequence(),
            shot=shot_value,
            code=decision_value.code,
            message=GUIDANCE_MESSAGES[decision_value.code],
            confidence=decision_value.confidence,
            observed_at=now,
            expires_at=now + self._guidance_ttl_ms,
        )
        self._shot = shot_value
        self._code = decision_value.code
        self._last_key = key
        self._last_guidance_expires_at = event.expires_at
        if shot_changed:
            self._shot_generation += 1
        return event

    async def analyze(
        self,
        provider: VisionGuidanceProvider,
        input: GuidanceInput | Mapping[str, object],
        *,
        observed_at: object | None = None,
    ) -> GuidanceEvent | None:
        validated_input = validate_guidance_input(input)
        generation = self._shot_generation
        result = await provider.analyze(validated_input)
        # A provider call can outlive a shot transition.  Its result belongs
        # to the old capture generation and must never overwrite the current
        # shot's guidance.
        if generation != self._shot_generation:
            return None
        if self._shot is not None and self._shot is not validated_input.requested_shot:
            return None
        return self.emit(
            validated_input.requested_shot,
            validate_vision_decision(result),
            observed_at=observed_at,
        )

    def set_shot(self, shot: object, *, observed_at: object | None = None) -> GuidanceStateEvent:
        shot_value = validate_guidance_shot(shot)
        now = self._now(observed_at)
        if shot_value != self._shot:
            self._shot = shot_value
            self._code = None
            self._last_key = None
            self._last_guidance_expires_at = None
            self._shot_generation += 1
        return GuidanceStateEvent(
            session_id=self._session_id,
            sequence=self._next_sequence(),
            kind="shot_changed",
            shot=self._shot,
            code=self._code,
            observed_at=now,
        )

    def resync(self, *, observed_at: object | None = None) -> GuidanceStateEvent:
        now = self._now(observed_at)
        code = self._code
        if (
            code is not None
            and self._last_guidance_expires_at is not None
            and now >= self._last_guidance_expires_at
        ):
            code = None
        return GuidanceStateEvent(
            session_id=self._session_id,
            sequence=self._next_sequence(),
            kind="resync",
            shot=self._shot,
            code=code,
            observed_at=now,
        )


__all__ = [
    "GUIDANCE_MESSAGES",
    "GuidanceEvent",
    "GuidanceStateEvent",
    "GuidanceStateMachine",
    "GuidanceValidationError",
    "TransportKind",
]
