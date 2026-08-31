from __future__ import annotations

import asyncio
import struct
import zlib

import pytest

from services.listing_photo_assistant.config import BackendSettings
from services.listing_photo_assistant.providers.mask import (
    FixtureGarmentMasker,
    MaskInput,
    MaskResult,
    ProviderError,
    RembgGarmentMasker,
    UnavailableGarmentMasker,
    create_garment_masker,
    validate_mask_png,
)


def png(width: int, height: int, pixels: bytes, *, color_type: int = 0) -> bytes:
    channels = {0: 1, 6: 4}[color_type]
    assert len(pixels) == width * height * channels
    raw = b"".join(
        b"\x00" + pixels[row * width * channels : (row + 1) * width * channels]
        for row in range(height)
    )

    def chunk(name: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + name + payload + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


SOURCE = png(3, 2, b"\x00\xff\x00\xff\x00\xff")


def run(coro):
    return asyncio.run(coro)


def test_fixture_is_deterministic_and_returns_source_sized_mask() -> None:
    provider = FixtureGarmentMasker()
    first = run(provider.mask(MaskInput(SOURCE, "image/png")))
    second = run(provider.mask(MaskInput(SOURCE, "image/png")))

    assert first.success is True
    assert first.mask_png == second.mask_png
    assert (first.width, first.height) == (3, 2)
    assert validate_mask_png(first.mask_png, expected_size=(3, 2)).pixels != b"\x00" * 6


@pytest.mark.parametrize(
    "case",
    ["unsupported-mime", "oversized", "invalid-image"],
    ids=["unsupported-mime", "oversized", "invalid-image"],
)
def test_input_mime_size_and_encoding_are_safe_failures(case: str) -> None:
    if case == "unsupported-mime":
        mime, data = "application/octet-stream", SOURCE
    elif case == "oversized":
        mime, data = "image/png", SOURCE + b"x" * (10 * 1024 * 1024)
    else:
        mime, data = "image/png", b"not-a-png"

    if case in {"unsupported-mime", "oversized"}:
        with pytest.raises(ProviderError):
            MaskInput(data, mime)
    else:
        result = run(FixtureGarmentMasker().mask(MaskInput(data, mime)))
        assert result.success is False
        assert result.error is not None


@pytest.mark.parametrize(
    "pixels",
    [b"\x00" * 6, b"\xff" * 6, b"\x80" * 6],
)
def test_empty_full_and_non_informative_masks_are_rejected(pixels: bytes) -> None:
    with pytest.raises(ProviderError):
        validate_mask_png(png(3, 2, pixels), expected_size=(3, 2))


def test_corrupt_and_dimension_mismatched_masks_are_rejected() -> None:
    valid = png(3, 2, b"\x00\xff\x00\xff\x00\xff")
    corrupt = valid[:-1] + b"x"
    with pytest.raises(ProviderError):
        validate_mask_png(corrupt, expected_size=(3, 2))
    with pytest.raises(ProviderError):
        validate_mask_png(png(2, 2, b"\x00\xff\x00\xff"), expected_size=(3, 2))


def test_live_adapter_extracts_alpha_and_drops_source_rgb() -> None:
    provider_output = png(3, 2, bytes([255, 1, 2, 0, 9, 8, 7, 255, 2, 3, 4, 0, 0, 0, 0, 255, 8, 9, 10, 0, 0, 0, 0, 255]), color_type=6)
    calls: list[bytes] = []

    def remove(source: bytes) -> bytes:
        calls.append(source)
        return provider_output

    result = run(RembgGarmentMasker(remove).mask(MaskInput(SOURCE, "image/png")))
    assert result.success is True
    assert calls == [SOURCE]
    assert validate_mask_png(result.mask_png, expected_size=(3, 2)).pixels == bytes([0, 255, 0, 255, 0, 255])


def test_invalid_live_output_is_not_success() -> None:
    result = run(RembgGarmentMasker(lambda source: b"partial").mask(MaskInput(SOURCE, "image/png")))
    assert result.success is False
    assert result.mask_png is None
    assert result.error is not None
    assert result.error.code == "INVALID_MASK"


def test_mask_result_cannot_be_constructed_as_success_with_unvalidated_bytes() -> None:
    with pytest.raises(ProviderError):
        MaskResult(True, b"not-a-mask", 3, 2)

    with pytest.raises(ValueError):
        MaskResult(1, b"not-a-mask", 3, 2)  # type: ignore[arg-type]


def test_unavailable_provider_validates_input_without_falling_back() -> None:
    result = run(UnavailableGarmentMasker().mask(MaskInput(b"not-a-png", "image/png")))

    assert result.success is False
    assert result.mask_png is None
    assert result.error is not None
    assert result.error.code == "INVALID_INPUT"


def test_factory_prioritizes_fixture_and_live_has_explicit_seam() -> None:
    fixture = create_garment_masker(BackendSettings("fixture", "127.0.0.1", 3001))
    live = create_garment_masker(
        BackendSettings("live", "127.0.0.1", 3001), live_backend=lambda source: png(3, 2, b"\x00\xff\x00\xff\x00\xff")
    )
    assert isinstance(fixture, FixtureGarmentMasker)
    assert isinstance(live, RembgGarmentMasker)
