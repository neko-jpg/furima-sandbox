"""Safe garment-mask provider contract and explicit fixture/live adapters.

The provider boundary accepts an encoded source image and returns a validated,
mask-only PNG.  A live rembg adapter may receive an RGBA PNG containing source
RGB pixels, but it extracts only alpha and emits a new grayscale PNG.  No
background-generation API or source RGB data crosses this boundary.
"""

from __future__ import annotations

import asyncio
import inspect
import struct
import zlib
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Protocol, runtime_checkable
from urllib.error import URLError
from urllib.request import Request, urlopen

from ..config import BackendSettings
from .errors import ProviderError as CommonProviderError
from .image_utils import ImagePayloadError, validate_image_payload


MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_MASK_PNG_BYTES = 10 * 1024 * 1024
MAX_IMAGE_DIMENSION = 16_384
MAX_IMAGE_PIXELS = 16_777_216
ALLOWED_INPUT_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Compatibility names used by callers that expose limits in their own config.
MAX_IMAGE_BYTES = MAX_INPUT_BYTES
MAX_PNG_BYTES = MAX_MASK_PNG_BYTES
ALLOWED_MIME_TYPES = ALLOWED_INPUT_MIME_TYPES


class ProviderError(CommonProviderError):
    """Mask-specific view of the shared safe provider error."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(code, message, retryable=retryable, provider="garment-masker")


class MaskContractError(ProviderError):
    """Raised internally when a mask contract is violated."""


@dataclass(frozen=True, slots=True)
class MaskInput:
    """One encoded garment image retained only for the provider call."""

    data: bytes
    mime_type: str = "image/jpeg"

    def __post_init__(self) -> None:
        if not isinstance(self.data, bytes) or not self.data:
            raise ProviderError("INVALID_INPUT", "Image data must be non-empty bytes")
        if not isinstance(self.mime_type, str) or self.mime_type not in ALLOWED_INPUT_MIME_TYPES:
            raise ProviderError("INVALID_INPUT", "Unsupported image MIME type")
        if len(self.data) > MAX_INPUT_BYTES:
            raise ProviderError("INVALID_INPUT", "Image exceeds the size limit")

    @property
    def image(self) -> bytes:
        return self.data

    @property
    def image_bytes(self) -> bytes:
        return self.data

    @property
    def mimeType(self) -> str:
        return self.mime_type


GarmentMaskInput = MaskInput


@dataclass(frozen=True, slots=True)
class MaskPngInfo:
    width: int
    height: int
    pixels: bytes


@dataclass(frozen=True, slots=True)
class MaskResult:
    """Success or safe failure; invalid masks can never be a success."""

    success: bool
    mask_png: bytes | None = None
    width: int | None = None
    height: int | None = None
    error: ProviderError | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.success, bool):
            raise ValueError("mask result success must be boolean")
        if self.success:
            if not self.mask_png or self.width is None or self.height is None:
                raise ValueError("successful mask results require validated PNG data and dimensions")
            if self.error is not None:
                raise ValueError("successful mask results cannot contain an error")
            # Keep the result object safe even when a caller constructs it
            # directly instead of using ``success_result``.
            validate_mask_png(self.mask_png, expected_size=(self.width, self.height))
        elif self.mask_png is not None or not isinstance(self.error, ProviderError):
            raise ValueError("failed mask results must not contain mask data and require an error")

    @classmethod
    def success_result(cls, png: bytes, info: MaskPngInfo) -> "MaskResult":
        return cls(True, png, info.width, info.height)

    @classmethod
    def failure(cls, error: ProviderError) -> "MaskResult":
        return cls(False, error=error)

    @property
    def is_success(self) -> bool:
        return self.success

    @property
    def ok(self) -> bool:
        return self.success

    @property
    def data(self) -> bytes | None:
        return self.mask_png

    @property
    def mask(self) -> bytes | None:
        return self.mask_png


@runtime_checkable
class GarmentMasker(Protocol):
    async def mask(self, input: MaskInput) -> MaskResult:
        """Return a validated mask or a safe failure result."""


@runtime_checkable
class RembgBackend(Protocol):
    def remove(self, source: bytes) -> bytes | Awaitable[bytes]:
        """Return provider output for the source image only."""


class HttpRembgBackend:
    """Minimal multipart client for the private rembg sidecar."""

    def __init__(self, endpoint: str, *, timeout_seconds: float = 35.0) -> None:
        from urllib.parse import urlparse

        parsed = urlparse(endpoint.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("rembg endpoint must be an absolute http(s) URL")
        if timeout_seconds <= 0:
            raise ValueError("rembg timeout must be positive")
        self.endpoint = endpoint.strip()
        self.timeout_seconds = timeout_seconds

    def remove(self, source: bytes) -> bytes:
        boundary = "----furima-rembg-boundary"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"front\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode("ascii")
            + source
            + b"\r\n",
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nbirefnet-general-lite\r\n".encode("ascii"),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"om\"\r\n\r\ntrue\r\n".encode("ascii"),
            f"--{boundary}--\r\n".encode("ascii"),
        ]
        request = Request(
            self.endpoint,
            data=b"".join(parts),
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                result = response.read(MAX_MASK_PNG_BYTES + 1)
        except (OSError, URLError) as error:
            raise _error("UNAVAILABLE", "rembg sidecar is unavailable", retryable=True) from error
        if len(result) > MAX_MASK_PNG_BYTES:
            raise _error("INVALID_MASK", "rembg sidecar returned an oversized mask", retryable=True)
        return result


def _error(code: str, message: str, *, retryable: bool = False) -> ProviderError:
    return ProviderError(code, message, retryable=retryable)


def _coerce_input(value: object) -> MaskInput:
    if isinstance(value, MaskInput):
        return value
    if isinstance(value, Mapping):
        if set(value) - {"data", "image", "imageBytes", "mimeType", "mime_type"}:
            raise _error("INVALID_INPUT", "Mask input contains unknown fields")
        raw = value.get("data", value.get("image", value.get("imageBytes")))
        mime = value.get("mimeType", value.get("mime_type", "image/jpeg"))
        if not isinstance(raw, bytes) or not isinstance(mime, str):
            raise _error("INVALID_INPUT", "Mask input requires encoded bytes and MIME type")
        return MaskInput(raw, mime)
    raise _error("INVALID_INPUT", "Mask input must be an image object")


def _read_png_chunks(data: bytes, *, limit: int = MAX_MASK_PNG_BYTES) -> list[tuple[bytes, bytes]]:
    if len(data) > limit:
        raise _error("INVALID_MASK", "Mask PNG exceeds the size limit")
    if not data.startswith(PNG_SIGNATURE):
        raise _error("INVALID_MASK", "Mask is not a PNG")
    chunks: list[tuple[bytes, bytes]] = []
    offset = len(PNG_SIGNATURE)
    saw_iend = False
    while offset < len(data):
        if len(data) - offset < 12:
            raise _error("INVALID_MASK", "Mask PNG has a truncated chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        offset += 4
        chunk_type = data[offset : offset + 4]
        offset += 4
        if len(chunk_type) != 4 or length > limit or length > len(data) - offset - 4:
            raise _error("INVALID_MASK", "Mask PNG has an invalid chunk length")
        chunk_data = data[offset : offset + length]
        offset += length
        actual_crc = struct.unpack_from(">I", data, offset)[0]
        offset += 4
        expected_crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise _error("INVALID_MASK", "Mask PNG has an invalid chunk checksum")
        if saw_iend:
            raise _error("INVALID_MASK", "Mask PNG has data after IEND")
        chunks.append((chunk_type, chunk_data))
        if chunk_type == b"IEND":
            saw_iend = True
            if offset != len(data):
                raise _error("INVALID_MASK", "Mask PNG has trailing data")
    if not saw_iend:
        raise _error("INVALID_MASK", "Mask PNG is missing IEND")
    return chunks


def _unfilter_png(raw: bytes, width: int, height: int, channels: int) -> bytes:
    row_size = width * channels
    expected = height * (row_size + 1)
    if len(raw) != expected:
        raise _error("INVALID_MASK", "Mask PNG pixel data is incomplete")
    rows: list[bytearray] = []
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        encoded = raw[offset : offset + row_size]
        offset += row_size
        row = bytearray(row_size)
        previous = rows[-1] if rows else None
        for index, value in enumerate(encoded):
            left = row[index - channels] if index >= channels else 0
            up = previous[index] if previous is not None else 0
            upper_left = previous[index - channels] if previous is not None and index >= channels else 0
            if filter_type == 0:
                result = value
            elif filter_type == 1:
                result = (value + left) & 0xFF
            elif filter_type == 2:
                result = (value + up) & 0xFF
            elif filter_type == 3:
                result = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                estimate = left + up - upper_left
                pa = abs(estimate - left)
                pb = abs(estimate - up)
                pc = abs(estimate - upper_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else upper_left
                result = (value + predictor) & 0xFF
            else:
                raise _error("INVALID_MASK", "Mask PNG uses an unsupported filter")
            row[index] = result
        rows.append(row)
    return b"".join(rows)


def _decode_png(data: bytes, *, allow_rgba: bool) -> tuple[MaskPngInfo, int]:
    chunks = _read_png_chunks(data)
    if not chunks or chunks[0][0] != b"IHDR":
        raise _error("INVALID_MASK", "Mask PNG must begin with IHDR")
    if sum(chunk_type == b"IHDR" for chunk_type, _ in chunks) != 1:
        raise _error("INVALID_MASK", "Mask PNG must contain one IHDR")
    ihdr = chunks[0][1]
    if len(ihdr) != 13:
        raise _error("INVALID_MASK", "Mask PNG has an invalid IHDR")
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", ihdr)
    if not width or not height or bit_depth != 8 or compression != 0 or filtering != 0 or interlace != 0:
        raise _error("INVALID_MASK", "Mask PNG uses unsupported image settings")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS:
        raise _error("INVALID_MASK", "Mask dimensions exceed the safety limit")
    channels_by_type = {0: 1, 2: 3, 4: 2, 6: 4}
    channels = channels_by_type.get(color_type)
    if channels is None or (color_type != 0 and not allow_rgba):
        raise _error("INVALID_MASK", "Mask PNG must be an 8-bit grayscale image")
    idat = b"".join(payload for chunk_type, payload in chunks if chunk_type == b"IDAT")
    if not idat or chunks[-1][0] != b"IEND" or any(
        chunk_type not in {b"IHDR", b"IDAT", b"IEND"} for chunk_type, _ in chunks
    ):
        raise _error("INVALID_MASK", "Mask PNG contains incomplete or unsupported chunks")
    try:
        raw = zlib.decompress(idat)
    except zlib.error as error:
        raise _error("INVALID_MASK", "Mask PNG pixel data is not valid zlib") from error
    pixels = _unfilter_png(raw, width, height, channels)
    if color_type == 0:
        mask_pixels = pixels
    elif color_type == 4:
        mask_pixels = pixels[1::2]
    elif color_type == 6:
        # Keep only alpha.  This deliberately discards any source RGB bytes.
        mask_pixels = pixels[3::4]
    else:
        raise _error("INVALID_MASK", "RGB mask output is not mask-only")
    info = MaskPngInfo(width, height, bytes(mask_pixels))
    if len(set(info.pixels)) < 2:
        raise _error("INVALID_MASK", "Mask is empty, full, or otherwise non-informative")
    return info, color_type


def validate_mask_png(data: bytes, *, expected_size: tuple[int, int] | None = None) -> MaskPngInfo:
    """Validate PNG structure, dimensions, and non-empty/non-full mask pixels."""

    if not isinstance(data, bytes) or not data:
        raise _error("INVALID_MASK", "Mask output must be non-empty bytes")
    info, color_type = _decode_png(data, allow_rgba=False)
    if color_type != 0:
        raise _error("INVALID_MASK", "Mask output must be grayscale mask-only PNG")
    if expected_size is not None and (info.width, info.height) != expected_size:
        raise _error("INVALID_MASK", "Mask dimensions do not match the source image")
    if len(data) > MAX_MASK_PNG_BYTES:
        raise _error("INVALID_MASK", "Mask PNG exceeds the size limit")
    return info


def _image_dimensions(source: bytes, mime_type: str) -> tuple[int, int]:
    """Fully decode a source image before sending it to rembg."""

    try:
        validate_image_payload(source, mime_type)
        from io import BytesIO

        from PIL import Image  # type: ignore[import-not-found]

        with Image.open(BytesIO(source)) as decoded:
            dimensions = (int(decoded.width), int(decoded.height))
        return dimensions
    except ImagePayloadError as error:
        raise _error("INVALID_INPUT", str(error)) from error
    except Exception as error:
        raise _error("INVALID_INPUT", "Image bytes are not a valid supported image") from error


def _jpeg_dimensions(source: bytes) -> tuple[int, int]:
    if len(source) < 4 or source[:2] != b"\xff\xd8":
        raise ValueError
    offset = 2
    sof_markers = set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0))
    while offset < len(source):
        while offset < len(source) and source[offset] != 0xFF:
            offset += 1
        while offset < len(source) and source[offset] == 0xFF:
            offset += 1
        if offset >= len(source):
            break
        marker = source[offset]
        offset += 1
        if marker in {0xD8, 0xD9}:
            continue
        if marker == 0xDA or offset + 2 > len(source):
            break
        segment_length = struct.unpack_from(">H", source, offset)[0]
        if segment_length < 2 or offset + segment_length > len(source):
            raise ValueError
        if marker in sof_markers:
            if segment_length < 7:
                raise ValueError
            height, width = struct.unpack_from(">HH", source, offset + 3)
            if width and height:
                return width, height
            raise ValueError
        offset += segment_length
    raise ValueError


def _webp_dimensions(source: bytes) -> tuple[int, int]:
    if len(source) < 20 or source[:4] != b"RIFF" or source[8:12] != b"WEBP":
        raise ValueError
    chunk = source[12:16]
    if chunk == b"VP8X":
        if len(source) < 30:
            raise ValueError
        width = 1 + int.from_bytes(source[24:27], "little")
        height = 1 + int.from_bytes(source[27:30], "little")
        return width, height
    if chunk == b"VP8 " and len(source) >= 30:
        start = 20
        if source[start : start + 3] != b"\x9d\x01\x2a":
            raise ValueError
        width, height = struct.unpack_from("<HH", source, start + 3)
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L" and len(source) >= 25 and source[20] == 0x2F:
        bits = int.from_bytes(source[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise ValueError


def _encode_gray_png(width: int, height: int, pixels: bytes) -> bytes:
    if len(pixels) != width * height:
        raise ValueError("pixel count does not match dimensions")
    raw = b"".join(b"\x00" + pixels[row * width : (row + 1) * width] for row in range(height))

    def chunk(name: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + name + payload + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)

    return PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def _validate_source(value: object) -> tuple[MaskInput, tuple[int, int]]:
    image = _coerce_input(value)
    return image, _image_dimensions(image.data, image.mime_type)


class FixtureGarmentMasker:
    """Deterministic local provider; it never calls a live or background API."""

    async def mask(self, input: MaskInput) -> MaskResult:
        try:
            _, (width, height) = _validate_source(input)
            # Checkerboard pixels guarantee both foreground and background for
            # every supported dimension >= 2 and remain byte-for-byte stable.
            if width < 2 or height < 2:
                raise _error("INVALID_INPUT", "Image must be at least 2x2 pixels")
            pixels = bytes(255 if (x + y) % 2 == 0 else 0 for y in range(height) for x in range(width))
            png = _encode_gray_png(width, height, pixels)
            return MaskResult.success_result(png, validate_mask_png(png, expected_size=(width, height)))
        except ProviderError as error:
            return MaskResult.failure(error)
        except Exception:
            return MaskResult.failure(_error("PROVIDER_FAILURE", "Mask fixture failed", retryable=True))


class RembgGarmentMasker:
    """Adapter seam for rembg or an equivalent live segmentation backend."""

    def __init__(self, backend: RembgBackend | Callable[[bytes], bytes | Awaitable[bytes]]) -> None:
        self._backend = backend

    async def mask(self, input: MaskInput) -> MaskResult:
        try:
            image, expected_size = _validate_source(input)
            remove = getattr(self._backend, "remove", self._backend)
            # The HTTP rembg adapter is synchronous; never block FastAPI's
            # event loop while waiting on the sidecar.  Async test/injection
            # seams remain supported because their coroutine is awaited below.
            raw = await asyncio.to_thread(remove, image.data)
            if inspect.isawaitable(raw):
                raw = await raw
            if not isinstance(raw, bytes) or not raw:
                raise _error("INVALID_MASK", "Live provider returned no mask")
            # Validate the provider PNG fully before extracting alpha.  RGBA
            # input is accepted only as an adapter input; RGB is never output.
            provider_info, provider_color_type = _decode_png(raw, allow_rgba=True)
            if (provider_info.width, provider_info.height) != expected_size:
                raise _error("INVALID_MASK", "Mask dimensions do not match the source image")
            if provider_color_type not in {0, 4, 6}:
                raise _error("INVALID_MASK", "Live provider output is not a mask")
            png = raw if provider_color_type == 0 else _encode_gray_png(provider_info.width, provider_info.height, provider_info.pixels)
            info = validate_mask_png(png, expected_size=expected_size)
            return MaskResult.success_result(png, info)
        except ProviderError as error:
            return MaskResult.failure(error)
        except Exception:
            return MaskResult.failure(_error("PROVIDER_FAILURE", "Live mask provider failed", retryable=True))


class UnavailableGarmentMasker:
    """Explicit live-mode failure; never silently falls back to fixture."""

    async def mask(self, input: MaskInput) -> MaskResult:
        try:
            _validate_source(input)
        except ProviderError as error:
            return MaskResult.failure(error)
        return MaskResult.failure(_error("UNAVAILABLE", "Live garment masker is unavailable", retryable=True))


def _create_rembg_backend(endpoint: str = "") -> RembgBackend:
    endpoint = endpoint.strip()
    if endpoint:
        return HttpRembgBackend(endpoint)
    try:
        from rembg import remove  # type: ignore[import-not-found]
    except ImportError as error:
        raise _error("UNAVAILABLE", "rembg is required for live garment masking", retryable=True) from error

    class _FunctionBackend:
        def remove(self, source: bytes) -> bytes:
            return remove(source)

    return _FunctionBackend()


def create_garment_masker(
    settings: BackendSettings | str | None = None,
    *,
    mode: str | None = None,
    live_backend: RembgBackend | Callable[[bytes], bytes | Awaitable[bytes]] | None = None,
) -> GarmentMasker:
    """Construct only the explicitly selected provider; fixture is the default."""

    if mode is not None:
        selected_mode = mode
    elif isinstance(settings, BackendSettings):
        selected_mode = settings.provider_mode
    elif isinstance(settings, str):
        selected_mode = settings
    elif settings is None:
        selected_mode = BackendSettings.from_env().provider_mode
    else:
        selected_mode = BackendSettings.from_env().provider_mode
    selected_mode = selected_mode.value if hasattr(selected_mode, "value") else selected_mode.strip().lower()
    if selected_mode == "fixture":
        return FixtureGarmentMasker()
    if selected_mode != "live":
        raise _error("INVALID_INPUT", "PROVIDER_MODE must be fixture or live")
    if live_backend is not None:
        return RembgGarmentMasker(live_backend)
    try:
        endpoint = settings.rembg_url if isinstance(settings, BackendSettings) else BackendSettings.from_env().rembg_url
        return RembgGarmentMasker(_create_rembg_backend(endpoint))
    except ProviderError as error:
        if error.code.value == "INVALID_INPUT":
            raise
        return UnavailableGarmentMasker()


def get_configured_garment_masker() -> GarmentMasker:
    return create_garment_masker()


# Short aliases make the adapter seam easy to inject in small service tests.
FixtureMasker = FixtureGarmentMasker
RembgMasker = RembgGarmentMasker


# Common method name used by service callers that phrase the operation as
# generation.  The adapter still exposes only mask bytes and never background data.
async def generate_mask(provider: GarmentMasker, input: MaskInput) -> MaskResult:
    return await provider.mask(input)


__all__ = [
    "ALLOWED_INPUT_MIME_TYPES",
    "ALLOWED_MIME_TYPES",
    "FixtureGarmentMasker",
    "GarmentMaskInput",
    "GarmentMasker",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_DIMENSION",
    "MAX_IMAGE_PIXELS",
    "MAX_INPUT_BYTES",
    "MAX_MASK_PNG_BYTES",
    "MAX_PNG_BYTES",
    "MaskContractError",
    "MaskInput",
    "MaskPngInfo",
    "MaskResult",
    "PNG_SIGNATURE",
    "ProviderError",
    "RembgBackend",
    "HttpRembgBackend",
    "RembgGarmentMasker",
    "RembgMasker",
    "FixtureMasker",
    "UnavailableGarmentMasker",
    "create_garment_masker",
    "generate_mask",
    "get_configured_garment_masker",
    "validate_mask_png",
]
