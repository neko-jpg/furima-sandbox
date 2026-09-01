from __future__ import annotations

import asyncio
import struct
import zlib

import pytest

from services.listing_photo_assistant.providers.mask import MaskResult
from services.listing_photo_assistant.rembg_prewarm import RembgPrewarmError, prewarm_rembg


def png(width: int, height: int, pixels: bytes) -> bytes:
    assert len(pixels) == width * height
    raw = b"".join(b"\x00" + pixels[row * width : (row + 1) * width] for row in range(height))

    def chunk(name: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + name
            + payload
            + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


FRONT = png(2, 2, bytes([0, 255, 255, 0]))
MASK = png(2, 2, bytes([0, 255, 255, 0]))


def run(coro):
    return asyncio.run(coro)


def test_prewarm_uses_the_production_mask_contract_and_returns_verified_mask() -> None:
    calls: list[bytes] = []

    def backend(source: bytes) -> bytes:
        calls.append(source)
        return MASK

    result = run(prewarm_rembg(FRONT, "image/png", backend=backend))

    assert isinstance(result, MaskResult)
    assert result.success is True
    assert result.mask_png == MASK
    assert calls == [FRONT]


@pytest.mark.parametrize(
    "invalid",
    [b"not-png", png(2, 2, b"\x00\x00\x00\x00"), png(2, 2, b"\xff\xff\xff\xff")],
)
def test_prewarm_fails_closed_on_invalid_sidecar_output(invalid: bytes) -> None:
    with pytest.raises(RembgPrewarmError):
        run(prewarm_rembg(FRONT, "image/png", backend=lambda source: invalid))


def test_prewarm_does_not_allow_two_dependency_seams() -> None:
    with pytest.raises(ValueError, match="either masker or backend"):
        run(prewarm_rembg(FRONT, "image/png", masker=object(), backend=lambda source: MASK))
