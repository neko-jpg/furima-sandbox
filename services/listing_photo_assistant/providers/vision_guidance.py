"""Runtime-validated contract for live vision guidance providers.

The model may return only a finite guidance code and confidence.  Human-facing
copy, sequence numbers, expiry, and transport are owned by the state machine.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from enum import Enum
from math import isfinite
from typing import Protocol, TypeAlias, runtime_checkable


class GuidanceContractError(ValueError):
    """Raised when a guidance input or provider decision is invalid."""


class GuidanceCode(str, Enum):
    MOVE_CLOSER = "MOVE_CLOSER"
    MOVE_FARTHER = "MOVE_FARTHER"
    CENTER_GARMENT = "CENTER_GARMENT"
    SHOW_FULL_GARMENT = "SHOW_FULL_GARMENT"
    WRONG_SIDE = "WRONG_SIDE"
    MOVE_TO_TAG = "MOVE_TO_TAG"
    PLACE_MARKER = "PLACE_MARKER"
    MARKER_NOT_VISIBLE = "MARKER_NOT_VISIBLE"
    FLATTEN_GARMENT = "FLATTEN_GARMENT"
    CAMERA_OVERHEAD = "CAMERA_OVERHEAD"
    HOLD_STEADY = "HOLD_STEADY"
    READY = "READY"
    AGENT_UNAVAILABLE = "AGENT_UNAVAILABLE"


class GuidanceShot(str, Enum):
    FRONT = "front"
    BACK = "back"
    TAG = "tag"
    MEASUREMENT = "measurement"


GUIDANCE_CODES = tuple(item.value for item in GuidanceCode)
GUIDANCE_SHOTS = tuple(item.value for item in GuidanceShot)


def _enum_value(enum_type: type[Enum], value: object, field: str) -> Enum:
    if isinstance(value, enum_type):
        return value
    if not isinstance(value, str):
        raise GuidanceContractError(f"{field} must be a string")
    try:
        return enum_type(value)
    except ValueError as error:
        allowed = ", ".join(item.value for item in enum_type)
        raise GuidanceContractError(f"{field} must be one of: {allowed}") from error


def validate_guidance_code(value: object) -> GuidanceCode:
    return _enum_value(GuidanceCode, value, "code")  # type: ignore[return-value]


def validate_guidance_shot(value: object) -> GuidanceShot:
    return _enum_value(GuidanceShot, value, "requestedShot")  # type: ignore[return-value]


def _confidence(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise GuidanceContractError("confidence must be a finite number")
    converted = float(value)
    if not isfinite(converted) or not 0.0 <= converted <= 1.0:
        raise GuidanceContractError("confidence must be between 0 and 1")
    return converted


@dataclass(frozen=True, slots=True)
class EncodedImage:
    """One downscaled encoded frame selected by the Agent."""

    data: bytes
    mime_type: str = "image/jpeg"
    width: int | None = None
    height: int | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.data, bytes) or not self.data:
            raise GuidanceContractError("frame.data must be non-empty bytes")
        if not isinstance(self.mime_type, str) or not self.mime_type.startswith("image/"):
            raise GuidanceContractError("frame.mime_type must be an image MIME type")
        for field, value in (("width", self.width), ("height", self.height)):
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, int) or value <= 0
            ):
                raise GuidanceContractError(f"frame.{field} must be a positive integer")


@dataclass(frozen=True, slots=True)
class GuidanceInput:
    frame: EncodedImage
    requested_shot: GuidanceShot
    previous_code: GuidanceCode | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.frame, EncodedImage):
            raise GuidanceContractError("frame must be an EncodedImage")
        object.__setattr__(self, "requested_shot", validate_guidance_shot(self.requested_shot))
        if self.previous_code is not None:
            object.__setattr__(
                self, "previous_code", validate_guidance_code(self.previous_code)
            )

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "GuidanceInput":
        if not isinstance(value, Mapping):
            raise GuidanceContractError("guidance input must be an object")
        allowed = {"frame", "requestedShot", "previousCode"}
        if set(value) - allowed or not {"frame", "requestedShot"} <= set(value):
            raise GuidanceContractError(
                "guidance input requires only frame, requestedShot, and optional previousCode"
            )
        raw_frame = value["frame"]
        if isinstance(raw_frame, Mapping):
            frame_allowed = {"data", "mimeType", "width", "height"}
            if set(raw_frame) - frame_allowed or "data" not in raw_frame:
                raise GuidanceContractError("frame contains unknown or missing fields")
            frame = EncodedImage(
                data=raw_frame["data"],  # type: ignore[arg-type]
                mime_type=raw_frame.get("mimeType", "image/jpeg"),  # type: ignore[arg-type]
                width=raw_frame.get("width"),  # type: ignore[arg-type]
                height=raw_frame.get("height"),  # type: ignore[arg-type]
            )
        elif isinstance(raw_frame, bytes):
            frame = EncodedImage(raw_frame)
        else:
            raise GuidanceContractError("frame must be encoded bytes or an image object")
        return cls(
            frame=frame,
            requested_shot=validate_guidance_shot(value["requestedShot"]),
            previous_code=(
                None
                if value.get("previousCode") is None
                else validate_guidance_code(value["previousCode"])
            ),
        )

    @property
    def requestedShot(self) -> str:
        return self.requested_shot.value

    @property
    def previousCode(self) -> str | None:
        return None if self.previous_code is None else self.previous_code.value


@dataclass(frozen=True, slots=True)
class VisionDecision:
    code: GuidanceCode
    confidence: float

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", validate_guidance_code(self.code))
        object.__setattr__(self, "confidence", _confidence(self.confidence))

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "VisionDecision":
        if not isinstance(value, Mapping) or set(value) != {"code", "confidence"}:
            raise GuidanceContractError("vision decision requires only code and confidence")
        return cls(
            code=validate_guidance_code(value["code"]),
            confidence=_confidence(value["confidence"]),
        )


def validate_guidance_input(value: object) -> GuidanceInput:
    if isinstance(value, GuidanceInput):
        return value
    if isinstance(value, Mapping):
        return GuidanceInput.from_mapping(value)
    raise GuidanceContractError("guidance input must be GuidanceInput or an object")


def validate_vision_decision(value: object) -> VisionDecision:
    if isinstance(value, VisionDecision):
        return value
    if isinstance(value, Mapping):
        return VisionDecision.from_mapping(value)
    raise GuidanceContractError("vision decision must be VisionDecision or an object")


@runtime_checkable
class VisionGuidanceProvider(Protocol):
    async def analyze(self, input: GuidanceInput) -> VisionDecision | Mapping[str, object]:
        """Analyze one selected frame and return a finite decision."""


LiveVisionResult: TypeAlias = VisionDecision | Mapping[str, object]
LiveVisionAnalyzer: TypeAlias = Callable[
    [GuidanceInput], LiveVisionResult | Awaitable[LiveVisionResult]
]


class LiveVisionProviderUnavailable(RuntimeError):
    """Raised when live mode has no concrete analyzer to invoke."""


class LiveVisionGuidanceProvider:
    """Validated adapter around an injected live image analyzer.

    The concrete implementation (for example an OpenAI Responses adapter) is
    owned by the parent provider integration.  This class deliberately knows
    only the small :class:`VisionGuidanceProvider` contract, which keeps the
    LiveKit transport independent from provider SDKs.  An absent analyzer is
    an explicit live-mode failure; it is never replaced with a fixture
    provider.
    """

    def __init__(
        self,
        analyzer: LiveVisionAnalyzer | VisionGuidanceProvider | None = None,
        *,
        provider: VisionGuidanceProvider | None = None,
    ) -> None:
        if analyzer is not None and provider is not None:
            raise TypeError("provide analyzer or provider, not both")
        self._analyzer = analyzer if analyzer is not None else provider

    @property
    def available(self) -> bool:
        """Whether a concrete live analyzer was injected."""

        return self._analyzer is not None

    async def analyze(self, input: GuidanceInput) -> VisionDecision:
        validated_input = validate_guidance_input(input)
        analyzer = self._analyzer
        if analyzer is None:
            raise LiveVisionProviderUnavailable(
                "live guidance analyzer is not configured; "
                "inject a concrete live provider or use PROVIDER_MODE=fixture"
            )

        analyze = getattr(analyzer, "analyze", None)
        if callable(analyze):
            result = analyze(validated_input)
        elif callable(analyzer):
            result = analyzer(validated_input)
        else:
            raise LiveVisionProviderUnavailable(
                "injected live guidance provider must expose analyze(input) "
                "or be callable"
            )
        if inspect.isawaitable(result):
            result = await result
        return validate_vision_decision(result)


class FixtureVisionGuidanceProvider:
    """Deterministic guidance used by local fixture mode."""

    async def analyze(self, input: GuidanceInput) -> VisionDecision:
        validated = validate_guidance_input(input)
        code = (
            GuidanceCode.PLACE_MARKER
            if validated.requested_shot is GuidanceShot.MEASUREMENT
            else GuidanceCode.READY
        )
        return VisionDecision(code=code, confidence=1.0)


class UnavailableLiveVisionGuidanceProvider:
    """Compatibility provider that emits an explicit unavailable decision.

    New runtime wiring should use :class:`LiveVisionGuidanceProvider` so a
    missing concrete provider raises and is mapped by the Agent error path.
    This compatibility class remains useful to integrations that want the
    finite ``AGENT_UNAVAILABLE`` decision directly.
    """

    async def analyze(self, input: GuidanceInput) -> VisionDecision:
        del input
        return VisionDecision(GuidanceCode.AGENT_UNAVAILABLE, 0.0)


__all__ = [
    "EncodedImage",
    "FixtureVisionGuidanceProvider",
    "GUIDANCE_CODES",
    "GUIDANCE_SHOTS",
    "GuidanceCode",
    "GuidanceContractError",
    "GuidanceInput",
    "GuidanceShot",
    "LiveVisionAnalyzer",
    "LiveVisionGuidanceProvider",
    "LiveVisionProviderUnavailable",
    "LiveVisionResult",
    "UnavailableLiveVisionGuidanceProvider",
    "VisionDecision",
    "VisionGuidanceProvider",
    "validate_guidance_code",
    "validate_guidance_input",
    "validate_guidance_shot",
    "validate_vision_decision",
]
