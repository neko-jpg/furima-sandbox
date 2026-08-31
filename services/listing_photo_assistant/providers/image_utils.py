"""Small, dependency-light image helpers used by assistant providers.

The browser never talks to these helpers directly.  They exist at the service
boundary so uploads are bounded before a provider or a sidecar sees them and
so mask responses can be normalized to grayscale PNGs without product RGB.
"""

from __future__ import annotations

import struct
import zlib
from collections.abc import Callable
from io import BytesIO


MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_DIMENSION = 16_384
MAX_IMAGE_PIXELS = 16_777_216
ALLOWED_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_EXPECTED_FORMATS = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


class ImagePayloadError(ValueError):
    """Raised when an image upload cannot be accepted by a provider."""


def validate_image_payload(image: bytes, content_type: str | None) -> bytes:
    if content_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise ImagePayloadError("Unsupported image MIME type")
    if not image:
        raise ImagePayloadError("Image file is empty")
    if len(image) > MAX_IMAGE_BYTES:
        raise ImagePayloadError("Image exceeds the upload size limit")
    _validate_decoded_image(image, content_type)
    return image


def _validate_decoded_image(image: bytes, content_type: str) -> tuple[int, int]:
    """Decode the complete upload and enforce MIME/dimension/pixel limits."""

    try:
        from PIL import Image  # type: ignore[import-not-found]

        with Image.open(BytesIO(image)) as inspected:
            if inspected.format != _EXPECTED_FORMATS[content_type]:
                raise ImagePayloadError("Image MIME type does not match its encoded format")
            width, height = int(inspected.width), int(inspected.height)
            if (
                not 1 <= width <= MAX_IMAGE_DIMENSION
                or not 1 <= height <= MAX_IMAGE_DIMENSION
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise ImagePayloadError("Image dimensions exceed the safety limit")
            inspected.verify()

        # ``verify`` validates the encoded stream but invalid pixel data can
        # still surface only during a real decode. Reopen after verify as
        # required by Pillow and force all pixels to be read.
        with Image.open(BytesIO(image)) as decoded:
            decoded.load()
            if (int(decoded.width), int(decoded.height)) != (width, height):
                raise ImagePayloadError("Image dimensions changed during decoding")
        return width, height
    except ImagePayloadError:
        raise
    except Exception as error:
        raise ImagePayloadError("Image bytes are not a valid supported image") from error


def _png_dimensions(image: bytes) -> tuple[int, int] | None:
    if len(image) < 24 or image[:8] != b"\x89PNG\r\n\x1a\n" or image[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", image[16:24])
    return (width, height) if width > 0 and height > 0 else None


def _jpeg_dimensions(image: bytes) -> tuple[int, int] | None:
    if len(image) < 4 or image[:2] != b"\xff\xd8":
        return None
    index = 2
    while index + 9 < len(image):
        if image[index] != 0xFF:
            index += 1
            continue
        while index < len(image) and image[index] == 0xFF:
            index += 1
        if index >= len(image):
            break
        marker = image[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(image):
            break
        segment_length = int.from_bytes(image[index:index + 2], "big")
        if segment_length < 2 or index + segment_length > len(image):
            break
        if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
            if segment_length >= 7:
                height = int.from_bytes(image[index + 3:index + 5], "big")
                width = int.from_bytes(image[index + 5:index + 7], "big")
                if width > 0 and height > 0:
                    return width, height
        index += segment_length
    return None


def _webp_dimensions(image: bytes) -> tuple[int, int] | None:
    if len(image) < 30 or image[:4] != b"RIFF" or image[8:12] != b"WEBP":
        return None
    if image[12:16] == b"VP8X":
        width = 1 + int.from_bytes(image[24:27], "little")
        height = 1 + int.from_bytes(image[27:30], "little")
        return (width, height) if width > 0 and height > 0 else None
    return None


def image_dimensions(image: bytes) -> tuple[int, int]:
    for content_type in ("image/jpeg", "image/png", "image/webp"):
        try:
            return _validate_decoded_image(image, content_type)
        except ImagePayloadError:
            continue
    raise ImagePayloadError("Unable to determine image dimensions")


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def encode_grayscale_png(width: int, height: int, pixel: Callable[[int, int], int]) -> bytes:
    if not 1 <= width <= 1600 or not 1 <= height <= 1600:
        raise ImagePayloadError("Image dimensions are outside the supported range")
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # PNG filter type: None
        rows.extend(max(0, min(255, int(pixel(x, y)))) for x in range(width))
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + _png_chunk(b"IEND", b"")


def fixture_mask_png(width: int, height: int) -> bytes:
    cx, cy = width / 2, height / 2
    rx, ry = max(1.0, width * 0.34), max(1.0, height * 0.40)

    def pixel(x: int, y: int) -> int:
        distance = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        return 255 if distance <= 1 else 0

    return encode_grayscale_png(width, height, pixel)


def fixture_background_png(style_id: str, width: int = 768, height: int = 768) -> bytes:
    colors = {
        "studio_white": (248, 248, 248),
        "warm_neutral": (241, 232, 220),
        "light_wood": (224, 198, 158),
    }
    red, green, blue = colors[style_id]

    # Grayscale is enough for a fixture preview; the UI supplies the original
    # front RGB when it composites the approved result.
    value = round((red + green + blue) / 3)
    return encode_grayscale_png(width, height, lambda _x, _y: value)


def normalize_mask_png(mask: bytes, expected_dimensions: tuple[int, int] | None = None) -> bytes:
    """Return a grayscale-only PNG, stripping RGB from sidecar responses."""

    try:
        from PIL import Image  # type: ignore[import-not-found]

        with Image.open(BytesIO(mask)) as decoded:
            if decoded.format != "PNG":
                raise ImagePayloadError("Mask provider must return PNG")
            if expected_dimensions and decoded.size != expected_dimensions:
                raise ImagePayloadError("Mask dimensions do not match the source image")
            if "A" in decoded.getbands():
                normalized = decoded.getchannel("A")
            elif decoded.mode in {"1", "L", "I", "F"}:
                normalized = decoded.convert("L")
            else:
                raise ImagePayloadError("Mask provider returned product RGB without alpha")
            output = BytesIO()
            normalized.save(output, format="PNG", optimize=False)
            return output.getvalue()
    except ImagePayloadError:
        raise
    except Exception as error:
        raise ImagePayloadError("Mask provider returned invalid PNG") from error


__all__ = [
    "ALLOWED_IMAGE_MIME_TYPES",
    "ImagePayloadError",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_DIMENSION",
    "MAX_IMAGE_PIXELS",
    "encode_grayscale_png",
    "fixture_background_png",
    "fixture_mask_png",
    "image_dimensions",
    "normalize_mask_png",
    "validate_image_payload",
]
