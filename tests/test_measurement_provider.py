"""Pytest contract tests for the listing-photo measurement provider."""

import asyncio
import math
import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parents[1] / "services"))

from listing_photo_assistant.providers.measurement import (  # noqa: E402
    FixtureMeasurementLineProvider,
    LiveMeasurementLineProvider,
    MeasurementContractError,
    MeasurementFailure,
    MeasurementImage,
    MeasurementLineInput,
    MeasurementPointSuggestion,
    NormalizedPoint,
    ProviderError,
    ProviderErrorCode,
    create_measurement_line_provider,
)


def make_input(**image_options: object) -> MeasurementLineInput:
    return MeasurementLineInput(MeasurementImage(b"fixture-image", **image_options))


def test_fixture_is_the_default_and_returns_only_four_points() -> None:
    provider = create_measurement_line_provider()
    result = asyncio.run(provider.suggest(make_input()))

    assert isinstance(provider, FixtureMeasurementLineProvider)
    assert isinstance(result, MeasurementPointSuggestion)
    assert set(result.to_payload()) == {
        "lengthStart", "lengthEnd", "widthStart", "widthEnd"
    }
    assert all(
        0 <= value <= 1
        for name in ("length_start", "length_end", "width_start", "width_end")
        for value in (getattr(result, name).x, getattr(result, name).y)
    )


def test_fifty_mm_marker_mapping_keeps_cm_compatibility() -> None:
    input_value = MeasurementLineInput.from_mapping(
        {
            "image": {"data": b"x", "mimeType": "image/png"},
            "marker": {
                "knownSideCm": 5,
                "corners": [
                    {"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.1},
                    {"x": 0.2, "y": 0.2}, {"x": 0.1, "y": 0.2},
                ],
                "pxPerCm": 20,
            },
        }
    )

    assert input_value.marker is not None
    assert input_value.marker.known_side_mm == 50
    assert input_value.marker.known_side_cm == 5
    assert input_value.marker.px_per_mm == 2


@pytest.mark.parametrize(
    "data",
    [b"", b"x" * (10 * 1024 * 1024 + 1)],
    ids=["empty", "over-limit"],
)
def test_image_size_is_limited(data: bytes) -> None:
    with pytest.raises(MeasurementContractError):
        MeasurementImage(data)


@pytest.mark.parametrize("mime_type", ["image/gif", "application/octet-stream", "image/jpeg;profile=x"])
def test_image_mime_is_allowlisted(mime_type: str) -> None:
    with pytest.raises(MeasurementContractError):
        MeasurementImage(b"x", mime_type=mime_type)


@pytest.mark.parametrize(
    "point",
    [
        {"x": math.nan, "y": 0.1}, {"x": math.inf, "y": 0.1},
        {"x": -0.1, "y": 0.1}, {"x": 0.1, "y": 1.1},
    ],
)
def test_point_values_must_be_finite_and_normalized(point: dict[str, float]) -> None:
    with pytest.raises(MeasurementContractError):
        NormalizedPoint.from_mapping(point)


def test_projection_correction_is_required() -> None:
    with pytest.raises(MeasurementContractError, match="projection-corrected"):
        MeasurementLineInput(MeasurementImage(b"x"), projection_corrected=False)


def test_provider_public_api_accepts_bytes_and_content_type() -> None:
    result = asyncio.run(FixtureMeasurementLineProvider().suggest(b"x", "image/png"))

    assert isinstance(result, MeasurementPointSuggestion)


def test_provider_boundary_maps_invalid_input_to_provider_error() -> None:
    with pytest.raises(ProviderError) as raised:
        asyncio.run(FixtureMeasurementLineProvider().suggest(b"", "image/png"))

    assert raised.value.code is ProviderErrorCode.INVALID_INPUT
    assert raised.value.retryable is False


class FailingAdapter:
    async def suggest(self, input: MeasurementLineInput) -> dict[str, object]:
        del input
        raise RuntimeError("network down")


class InvalidAdapter:
    async def suggest(self, input: MeasurementLineInput) -> dict[str, object]:
        del input
        return {
            "lengthStart": {"x": 0, "y": 0}, "lengthEnd": {"x": 0, "y": 2},
            "widthStart": {"x": 0, "y": 0}, "widthEnd": {"x": 1, "y": 1},
        }


def test_live_failure_is_a_safe_result_without_fixture_fallback() -> None:
    provider = create_measurement_line_provider("live", live_adapter=FailingAdapter())
    result = asyncio.run(provider.suggest(make_input()))

    assert isinstance(result, MeasurementFailure)
    assert result.error.code is ProviderErrorCode.UNAVAILABLE
    assert result.to_payload()["ok"] is False


def test_live_invalid_response_is_a_provider_failure() -> None:
    result = asyncio.run(LiveMeasurementLineProvider(InvalidAdapter()).suggest(make_input()))

    assert isinstance(result, MeasurementFailure)
    assert result.error.code is ProviderErrorCode.INVALID_RESPONSE


def test_live_without_adapter_does_not_return_fixture_success() -> None:
    result = asyncio.run(create_measurement_line_provider("live").suggest(make_input()))

    assert isinstance(result, MeasurementFailure)
    assert result.error.code is ProviderErrorCode.UNAVAILABLE
