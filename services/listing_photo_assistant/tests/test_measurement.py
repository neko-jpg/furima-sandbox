from __future__ import annotations

import asyncio
from io import BytesIO
import math

import pytest

from services.listing_photo_assistant.providers.measurement import (
    ALLOWED_IMAGE_MIME_TYPES,
    MARKER_KNOWN_SIDE_CM,
    MARKER_KNOWN_SIDE_MM,
    MAX_IMAGE_BYTES,
    MEASUREMENT_PUBLIC_ERROR_CODES,
    FixtureMeasurementLineProvider,
    MeasurementContractError,
    MeasurementFailure,
    MeasurementImage,
    MeasurementLineInput,
    MeasurementMarker,
    MeasurementPointSuggestion,
    ProviderError,
    ProviderErrorCode,
    ResponsesMeasurementLineProvider,
    UnavailableLiveMeasurementLineProvider,
    create_measurement_line_provider,
    validate_measurement_suggestion,
)
from services.listing_photo_assistant.image_normalization import (
    normalize_measurement_image,
)


MEASUREMENT_IMAGE = b"projection-corrected-measurement-fixture"


def run(coro):
    return asyncio.run(coro)


def valid_suggestion() -> dict[str, object]:
    return {
        "lengthStart": {"x": 0.50, "y": 0.20},
        "lengthEnd": {"x": 0.50, "y": 0.82},
        "widthStart": {"x": 0.22, "y": 0.48},
        "widthEnd": {"x": 0.78, "y": 0.48},
    }


def valid_input() -> MeasurementLineInput:
    return MeasurementLineInput(
        MeasurementImage(MEASUREMENT_IMAGE, "image/png"),
        marker=MeasurementMarker.from_mapping(
            {
                "knownSideMm": MARKER_KNOWN_SIDE_MM,
                "corners": [
                    {"x": 0.10, "y": 0.10},
                    {"x": 0.20, "y": 0.10},
                    {"x": 0.20, "y": 0.20},
                    {"x": 0.10, "y": 0.20},
                ],
                "pxPerMm": 2,
            }
        ),
    )


def test_fixture_is_deterministic_and_returns_only_four_normalized_endpoints() -> None:
    provider = FixtureMeasurementLineProvider()

    first = run(provider.suggest(valid_input()))
    second = run(provider.suggest(valid_input()))

    assert isinstance(first, MeasurementPointSuggestion)
    assert first == second
    assert first.to_payload() == valid_suggestion()
    assert set(first.to_payload()) == {
        "lengthStart",
        "lengthEnd",
        "widthStart",
        "widthEnd",
    }
    assert "marker" not in first.to_payload()
    assert "valueCm" not in first.to_payload()
    for endpoint in ("lengthStart", "lengthEnd", "widthStart", "widthEnd"):
        point = first.to_payload()[endpoint]
        assert 0 <= point["x"] <= 1
        assert 0 <= point["y"] <= 1


def test_fifty_mm_marker_accepts_cm_compatibility_and_exactly_four_corners() -> None:
    marker = MeasurementMarker.from_mapping(
        {
            "knownSideCm": MARKER_KNOWN_SIDE_CM,
            "corners": [
                {"x": 0.1, "y": 0.1},
                {"x": 0.2, "y": 0.1},
                {"x": 0.2, "y": 0.2},
                {"x": 0.1, "y": 0.2},
            ],
            "pxPerCm": 20,
        }
    )

    assert marker.known_side_mm == 50
    assert marker.known_side_cm == 5
    assert marker.px_per_mm == 2
    assert marker.px_per_cm == 20


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, -0.01, 1.01])
def test_nonfinite_and_out_of_range_points_are_rejected(value: float) -> None:
    payload = valid_suggestion()
    payload["lengthStart"] = {"x": value, "y": 0.5}

    with pytest.raises(MeasurementContractError):
        validate_measurement_suggestion(payload)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload.update(extraField=1),
        lambda payload: payload.pop("lengthStart"),
        lambda payload: payload["lengthStart"].update(extra=0),
        lambda payload: payload["lengthStart"].pop("x"),
    ],
    ids=["extra-top-level", "missing-top-level", "extra-point-field", "missing-point-field"],
)
def test_extra_and_missing_suggestion_fields_are_rejected(mutate) -> None:
    payload = valid_suggestion()
    mutate(payload)

    with pytest.raises(MeasurementContractError):
        validate_measurement_suggestion(payload)


@pytest.mark.parametrize(
    ("data", "mime_type"),
    [
        (b"", "image/png"),
        (b"x", "image/gif"),
        (b"x", "application/octet-stream"),
        (b"x" * (MAX_IMAGE_BYTES + 1), "image/png"),
    ],
    ids=["empty", "gif", "octet-stream", "too-large"],
)
def test_measurement_image_enforces_nonempty_size_and_mime_contract(
    data: bytes, mime_type: str
) -> None:
    with pytest.raises(MeasurementContractError):
        MeasurementImage(data, mime_type)

    assert ALLOWED_IMAGE_MIME_TYPES == {"image/jpeg", "image/png", "image/webp"}


def test_projection_correction_is_required() -> None:
    with pytest.raises(MeasurementContractError, match="projection-corrected"):
        MeasurementLineInput(MeasurementImage(b"x"), projection_corrected=False)


class FailingAdapter:
    async def suggest(self, input: MeasurementLineInput) -> dict[str, object]:
        del input
        raise OSError("upstream unavailable")


class InvalidAdapter:
    async def suggest(self, input: MeasurementLineInput) -> dict[str, object]:
        del input
        invalid = valid_suggestion()
        invalid["widthEnd"] = {"x": 2, "y": 0.5}
        return invalid


def test_live_failure_is_safe_and_never_falls_back_to_fixture() -> None:
    provider = create_measurement_line_provider("live", live_adapter=FailingAdapter())
    result = run(provider.suggest(valid_input()))

    assert isinstance(result, MeasurementFailure)
    assert result.error.code is ProviderErrorCode.UNAVAILABLE
    assert result.to_payload()["ok"] is False
    assert result.to_payload()["error"]["retryable"] is True

    unavailable = create_measurement_line_provider("live")
    assert isinstance(unavailable, UnavailableLiveMeasurementLineProvider)
    assert isinstance(run(unavailable.suggest(valid_input())), MeasurementFailure)


def test_live_invalid_response_is_a_safe_provider_failure() -> None:
    provider = create_measurement_line_provider("live", live_adapter=InvalidAdapter())
    result = run(provider.suggest(valid_input()))

    assert isinstance(result, MeasurementFailure)
    assert result.error.code is ProviderErrorCode.INVALID_RESPONSE
    assert result.to_payload()["ok"] is False


class TimeoutAdapter:
    async def suggest(self, input: MeasurementLineInput) -> dict[str, object]:
        del input
        raise TimeoutError


def test_live_timeout_is_distinguished_from_generic_unavailable() -> None:
    provider = create_measurement_line_provider("live", live_adapter=TimeoutAdapter())
    result = run(provider.suggest(valid_input()))

    assert isinstance(result, MeasurementFailure)
    assert result.error.code is ProviderErrorCode.TIMEOUT


def test_failure_result_requires_a_provider_error() -> None:
    with pytest.raises(ValueError):
        MeasurementFailure("not-an-error")  # type: ignore[arg-type]


def test_transport_request_id_is_strict_and_never_sent_as_model_data() -> None:
    payload = {
        "image": {"data": MEASUREMENT_IMAGE, "mimeType": "image/png"},
        "requestId": "measurement-retry-1",
    }
    input_value = MeasurementLineInput.from_mapping(payload)

    assert input_value.request_id == "measurement-retry-1"
    request = ResponsesMeasurementLineProvider.request_for(input_value, "test-model")
    assert "requestId" not in request
    assert MEASUREMENT_PUBLIC_ERROR_CODES == {
        ProviderErrorCode.TIMEOUT,
        ProviderErrorCode.UNAVAILABLE,
        ProviderErrorCode.INVALID_RESPONSE,
        ProviderErrorCode.INVALID_INPUT,
        ProviderErrorCode.UNKNOWN,
    }


def test_internal_provider_codes_are_normalized_before_failure_serialization() -> None:
    failure = MeasurementFailure(
        ProviderError(
            ProviderErrorCode.INVALID_MASK,
            "internal detail must not cross the measurement boundary",
        )
    )

    assert failure.error.code is ProviderErrorCode.UNKNOWN
    assert failure.to_payload()["error"]["code"] == "UNKNOWN"
    assert failure.recovery_action in {"retry", "manual_placement", "manual_input"}


def test_measurement_normalization_is_canonical_and_deterministic() -> None:
    from PIL import Image

    source = BytesIO()
    Image.new("RGB", (4, 3), (32, 96, 160)).save(source, format="PNG")

    first = normalize_measurement_image(source.getvalue(), "image/png")
    second = normalize_measurement_image(source.getvalue(), "image/png")

    assert first == second
    assert first.mime_type == "image/png"
    assert first.is_srgb is True
    assert (first.width, first.height) == (4, 3)
