"""Background-only provider contract and explicit fixture/live adapters.

Only an allow-listed style id enters this boundary.  It is converted to a
fixed text prompt before a live generator is called; product images, masks,
tag images, measurement images, and binary fields have no place in the live
interface.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import inspect
import json
import math
import struct
import zlib
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol, TypeAlias, runtime_checkable
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from ..config import BackendSettings
from ..settings import (
    BACKGROUND_IMAGE_BACKGROUND,
    BACKGROUND_IMAGE_FALLBACK_QUALITY,
    BACKGROUND_IMAGE_FALLBACK_SIZE,
    BACKGROUND_IMAGE_OUTPUT_FORMAT,
    BACKGROUND_IMAGE_QUALITIES,
    BACKGROUND_IMAGE_SIZES,
    DEFAULT_BACKGROUND_IMAGE_QUALITY,
    DEFAULT_BACKGROUND_IMAGE_SIZE,
)
from .errors import ProviderError as CommonProviderError
from .image_utils import fixture_background_png
from .proxy_responses import AsyncResponsesResource

BackgroundStyleId = Literal["studio_white", "warm_neutral", "light_wood"]
BACKGROUND_STYLE_IDS = ("studio_white", "warm_neutral", "light_wood")
_BACKGROUND_STYLE_ALLOWLIST = frozenset(BACKGROUND_STYLE_IDS)
BACKGROUND_STYLE_ID_MAX_BYTES = 64
MAX_BACKGROUND_PNG_BYTES = 10 * 1024 * 1024
MAX_BACKGROUND_DIMENSION = 1600
BACKGROUND_GENERATION_TIMEOUT_SECONDS = 60.0
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

BACKGROUND_PROMPTS: Mapping[BackgroundStyleId, str] = {
    "studio_white": (
        "Create an empty matte soft-white product photography surface in a top-down 3:4 composition. "
        "Leave a generous, clean center for compositing a photographed product and add only a subtle, "
        "controlled light gradient with no hard cast shadow. Do not draw or imply any product, garment, "
        "clothing, hanger, person, text, logo, furniture, prop, or other object."
    ),
    "warm_neutral": (
        "Create an empty matte warm-neutral beige product photography surface in a top-down 3:4 composition. "
        "Leave a generous, clean center for compositing a photographed product and add only a subtle, "
        "controlled light gradient with no hard cast shadow. Do not draw or imply any product, garment, "
        "clothing, hanger, person, text, logo, furniture, prop, or other object."
    ),
    "light_wood": (
        "Create an empty matte pale light-wood product photography surface in a top-down 3:4 composition. "
        "Leave a generous, clean center for compositing a photographed product and add only a subtle, "
        "controlled light gradient with no hard cast shadow. Do not draw or imply any product, garment, "
        "clothing, hanger, person, text, logo, furniture, prop, or other object."
    ),
}
STYLE_PROMPTS = BACKGROUND_PROMPTS
FIXED_PROMPTS = BACKGROUND_PROMPTS


class ProviderError(CommonProviderError):
    """Background-specific view of the shared safe provider error."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(code, message, retryable=retryable, provider="background-generator")


BackgroundProviderError = ProviderError
BackgroundContractError = ProviderError


def validate_style_id(style_id: object) -> BackgroundStyleId:
    if not isinstance(style_id, str):
        raise ProviderError("INVALID_INPUT", "styleId must be a string", retryable=False)
    if len(style_id.encode("utf-8")) > BACKGROUND_STYLE_ID_MAX_BYTES:
        raise ProviderError("INVALID_INPUT", "styleId exceeds the size limit", retryable=False)
    if style_id not in _BACKGROUND_STYLE_ALLOWLIST:
        raise ProviderError("INVALID_INPUT", "styleId is not allowed", retryable=False)
    return style_id  # type: ignore[return-value]


def background_prompt(style_id: object) -> str:
    return BACKGROUND_PROMPTS[validate_style_id(style_id)]


def _validated_timeout(value: object, *, name: str, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or float(value) <= 0
        or float(value) > maximum
    ):
        raise ValueError(f"{name} must be finite and between 0 and {maximum:g} seconds")
    return float(value)


@dataclass(frozen=True, slots=True)
class BackgroundGenerationInput:
    style_id: BackgroundStyleId

    def __post_init__(self) -> None:
        object.__setattr__(self, "style_id", validate_style_id(self.style_id))

    @property
    def styleId(self) -> str:
        return self.style_id

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "BackgroundGenerationInput":
        if not isinstance(value, Mapping) or set(value) != {"styleId"}:
            raise ProviderError("INVALID_INPUT", "Background input requires only styleId", retryable=False)
        return cls(validate_style_id(value["styleId"]))  # type: ignore[arg-type]


BackgroundInput = BackgroundGenerationInput


@dataclass(frozen=True, slots=True)
class BackgroundPngInfo:
    width: int
    height: int
    color_type: int


def _read_png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if not isinstance(data, bytes) or not data:
        raise ProviderError("INVALID_RESPONSE", "Background output must be non-empty bytes", retryable=True)
    if len(data) > MAX_BACKGROUND_PNG_BYTES:
        raise ProviderError("INVALID_RESPONSE", "Background PNG exceeds the size limit", retryable=True)
    if not data.startswith(PNG_SIGNATURE):
        raise ProviderError("INVALID_RESPONSE", "Background output is not a PNG", retryable=True)
    chunks: list[tuple[bytes, bytes]] = []
    offset = len(PNG_SIGNATURE)
    saw_iend = False
    while offset < len(data):
        if len(data) - offset < 12:
            raise ProviderError("INVALID_RESPONSE", "Background PNG has a truncated chunk", retryable=True)
        length = struct.unpack_from(">I", data, offset)[0]
        offset += 4
        kind = data[offset:offset + 4]
        offset += 4
        if len(kind) != 4 or length > MAX_BACKGROUND_PNG_BYTES or length > len(data) - offset - 4:
            raise ProviderError("INVALID_RESPONSE", "Background PNG has an invalid chunk length", retryable=True)
        payload = data[offset:offset + length]
        offset += length
        actual_crc = struct.unpack_from(">I", data, offset)[0]
        offset += 4
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != actual_crc:
            raise ProviderError("INVALID_RESPONSE", "Background PNG has an invalid checksum", retryable=True)
        if saw_iend:
            raise ProviderError("INVALID_RESPONSE", "Background PNG has data after IEND", retryable=True)
        chunks.append((kind, payload))
        if kind == b"IEND":
            if payload:
                raise ProviderError("INVALID_RESPONSE", "Background PNG has an invalid IEND", retryable=True)
            saw_iend = True
            if offset != len(data):
                raise ProviderError("INVALID_RESPONSE", "Background PNG has trailing data", retryable=True)
    if not saw_iend:
        raise ProviderError("INVALID_RESPONSE", "Background PNG is missing IEND", retryable=True)
    return chunks


def validate_background_png(data: bytes) -> BackgroundPngInfo:
    """Validate PNG structure, CRCs, dimensions, scanlines, and size."""
    chunks = _read_png_chunks(data)
    if not chunks or chunks[0][0] != b"IHDR" or chunks[-1][0] != b"IEND":
        raise ProviderError("INVALID_RESPONSE", "Background PNG must begin with IHDR and end with IEND", retryable=True)
    if sum(kind == b"IHDR" for kind, _ in chunks) != 1:
        raise ProviderError("INVALID_RESPONSE", "Background PNG must contain one IHDR", retryable=True)
    header = chunks[0][1]
    if len(header) != 13:
        raise ProviderError("INVALID_RESPONSE", "Background PNG has an invalid IHDR", retryable=True)
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", header)
    if not 1 <= width <= MAX_BACKGROUND_DIMENSION or not 1 <= height <= MAX_BACKGROUND_DIMENSION:
        raise ProviderError("INVALID_RESPONSE", "Background dimensions are outside the supported range", retryable=True)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if channels is None or bit_depth != 8 or compression != 0 or filtering != 0 or interlace != 0:
        raise ProviderError("INVALID_RESPONSE", "Background PNG uses unsupported image settings", retryable=True)
    # PNG allows ancillary metadata chunks that are not known to the
    # consumer.  Codex Proxy's image tool currently includes a valid private
    # ancillary ``caBX`` chunk, so reject unknown *critical* chunks while
    # retaining the normal PNG CRC/size checks for ancillary data.
    if any(kind not in {b"IHDR", b"IDAT", b"IEND", b"PLTE", b"tRNS"} and not (kind[0] & 0x20) for kind, _ in chunks):
        raise ProviderError("INVALID_RESPONSE", "Background PNG contains unsupported chunks", retryable=True)
    if color_type == 3 and not any(kind == b"PLTE" for kind, _ in chunks):
        raise ProviderError("INVALID_RESPONSE", "Indexed background PNG is missing its palette", retryable=True)
    idat = b"".join(payload for kind, payload in chunks if kind == b"IDAT")
    if not idat:
        raise ProviderError("INVALID_RESPONSE", "Background PNG has no pixel data", retryable=True)
    try:
        decompressor = zlib.decompressobj()
        raw = decompressor.decompress(idat) + decompressor.flush()
        if not decompressor.eof or decompressor.unused_data:
            raise zlib.error("incomplete or trailing compressed data")
    except zlib.error as error:
        raise ProviderError("INVALID_RESPONSE", "Background PNG pixel data is invalid", retryable=True) from error
    row_size = width * channels
    if len(raw) != height * (row_size + 1):
        raise ProviderError("INVALID_RESPONSE", "Background PNG pixel data is incomplete", retryable=True)
    if any(raw[row * (row_size + 1)] > 4 for row in range(height)):
        raise ProviderError("INVALID_RESPONSE", "Background PNG uses an unsupported filter", retryable=True)
    return BackgroundPngInfo(width, height, color_type)


@dataclass(frozen=True, slots=True)
class BackgroundResult:
    """Validated PNG success, or a failure that contains no unverified bytes."""

    success: bool
    background_png: bytes | None = None
    width: int | None = None
    height: int | None = None
    error: ProviderError | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.success, bool):
            raise ValueError("background result success must be boolean")
        if self.success:
            if self.error is not None or not isinstance(self.background_png, bytes) or not self.background_png:
                raise ValueError("successful background results require PNG data and no error")
            info = validate_background_png(self.background_png)
            if (self.width, self.height) != (info.width, info.height):
                raise ValueError("successful background dimensions must match the PNG")
        elif self.background_png is not None or self.width is not None or self.height is not None or not isinstance(self.error, ProviderError):
            raise ValueError("failed background results must contain only an error")

    @classmethod
    def ok(cls, png: bytes) -> "BackgroundResult":
        info = validate_background_png(png)
        return cls(True, png, info.width, info.height)

    @classmethod
    def failure(cls, error: ProviderError) -> "BackgroundResult":
        if not isinstance(error, ProviderError):
            raise TypeError("background failures require ProviderError")
        return cls(False, error=error)

    @property
    def is_success(self) -> bool:
        return self.success

    @property
    def ok_result(self) -> bool:
        return self.success

    @property
    def data(self) -> bytes | None:
        return self.background_png


@runtime_checkable
class BackgroundGenerator(Protocol):
    async def generate(self, style_id: str | BackgroundGenerationInput) -> BackgroundResult: ...


@runtime_checkable
class TextPromptGenerator(Protocol):
    async def generate(self, prompt: str) -> bytes | BackgroundResult: ...


@runtime_checkable
class OpenAIImageClient(Protocol):
    async def generate(self, **kwargs: object) -> object:
        """Async subset of ``AsyncOpenAI.images`` used by the adapter."""


class CodexProxyImageClient(AsyncResponsesResource, Protocol):
    """Async subset of ``AsyncOpenAI.responses`` used by Codex Proxy."""


PromptGeneratorCallable: TypeAlias = Callable[[str], bytes | BackgroundResult | Awaitable[bytes | BackgroundResult]]


def _image_generation_tool(*, size: str, quality: str) -> dict[str, str]:
    """Build the closed image-tool payload shared by direct and proxy paths."""

    return {
        "type": "image_generation",
        "size": size,
        "quality": quality,
        "output_format": BACKGROUND_IMAGE_OUTPUT_FORMAT,
        "background": BACKGROUND_IMAGE_BACKGROUND,
    }


def _input(value: str | BackgroundGenerationInput) -> BackgroundGenerationInput:
    return value if isinstance(value, BackgroundGenerationInput) else BackgroundGenerationInput(validate_style_id(value))


async def _maybe_await(value: object) -> object:
    return await value if inspect.isawaitable(value) else value


def _call(client: TextPromptGenerator | PromptGeneratorCallable, prompt: str) -> object:
    generate = getattr(client, "generate", None)
    return generate(prompt) if callable(generate) else client(prompt)  # type: ignore[operator]


def _validated(raw: object) -> BackgroundResult:
    if isinstance(raw, BackgroundResult):
        if not raw.success:
            return raw
        return BackgroundResult.ok(raw.background_png or b"")
    if not isinstance(raw, bytes):
        raise ProviderError("INVALID_RESPONSE", "Background provider returned no PNG", retryable=True)
    return BackgroundResult.ok(raw)


class FixtureBackgroundGenerator:
    """Stable local output; it never calls a live generator."""

    async def generate(self, style_id: str | BackgroundGenerationInput) -> BackgroundResult:
        try:
            request = _input(style_id)
            return BackgroundResult.ok(fixture_background_png(request.style_id))
        except ProviderError as error:
            return BackgroundResult.failure(error)
        except Exception:
            return BackgroundResult.failure(ProviderError("PROVIDER_FAILURE", "Background fixture failed", retryable=True))


class LiveBackgroundGenerator:
    """Adapter seam for an injected text-only live generator."""

    def __init__(
        self,
        client: TextPromptGenerator | PromptGeneratorCallable,
        *,
        timeout_seconds: float = BACKGROUND_GENERATION_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self.timeout_seconds = _validated_timeout(
            timeout_seconds,
            name="background timeout",
            maximum=120.0,
        )

    async def generate(self, style_id: str | BackgroundGenerationInput) -> BackgroundResult:
        try:
            request = _input(style_id)
            async def invoke() -> object:
                return await _maybe_await(_call(self._client, background_prompt(request.style_id)))

            raw = await asyncio.wait_for(invoke(), timeout=self.timeout_seconds)
            return _validated(raw)
        except ProviderError as error:
            return BackgroundResult.failure(error)
        except TimeoutError:
            return BackgroundResult.failure(ProviderError("TIMEOUT", "Background provider timed out", retryable=True))
        except Exception:
            return BackgroundResult.failure(ProviderError("PROVIDER_FAILURE", "Live background provider failed", retryable=True))


def _base64_image(response: object) -> bytes:
    """Extract only a base64 image from an OpenAI Images response."""

    entries = getattr(response, "data", None)
    if entries is None and isinstance(response, Mapping):
        entries = response.get("data")
    if not isinstance(entries, (list, tuple)) or not entries:
        raise ProviderError("INVALID_RESPONSE", "Background provider returned no image", retryable=True)
    first = entries[0]
    encoded = getattr(first, "b64_json", None)
    if encoded is None and isinstance(first, Mapping):
        encoded = first.get("b64_json")
    if not isinstance(encoded, str) or not encoded:
        raise ProviderError("INVALID_RESPONSE", "Background provider returned no image", retryable=True)
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError, TypeError) as error:
        raise ProviderError("INVALID_RESPONSE", "Background provider returned invalid image data", retryable=True) from error


class OpenAIBackgroundGenerator(LiveBackgroundGenerator):
    """Concrete text-only OpenAI Images adapter.

    The only request value derived from the caller is the fixed style prompt;
    product images, masks, and other binary fields cannot reach this client.
    """

    def __init__(
        self,
        client: OpenAIImageClient,
        model: str = "gpt-image-2",
        *,
        size: str = DEFAULT_BACKGROUND_IMAGE_SIZE,
        quality: str = DEFAULT_BACKGROUND_IMAGE_QUALITY,
        timeout_seconds: float = BACKGROUND_GENERATION_TIMEOUT_SECONDS,
    ) -> None:
        if not isinstance(model, str) or not model.strip():
            raise ProviderError("INVALID_INPUT", "Background model must be non-empty", retryable=False)
        if size not in BACKGROUND_IMAGE_SIZES:
            raise ProviderError("INVALID_INPUT", "Background image size is not allowed", retryable=False)
        if quality not in BACKGROUND_IMAGE_QUALITIES:
            raise ProviderError("INVALID_INPUT", "Background image quality is not allowed", retryable=False)
        # ``LiveBackgroundGenerator`` stores its prompt callback in
        # ``_client``. Keep the SDK image client separate so ``super()`` does
        # not overwrite it before the first real generation request.
        self._image_client = client
        self._model = model
        self._size = size
        self._quality = quality
        super().__init__(self._generate_prompt, timeout_seconds=timeout_seconds)

    async def _generate_prompt(self, prompt: str) -> bytes:
        raw = self._image_client.generate(
            model=self._model,
            prompt=prompt,
            size=self._size,
            quality=self._quality,
            output_format=BACKGROUND_IMAGE_OUTPUT_FORMAT,
            background=BACKGROUND_IMAGE_BACKGROUND,
            response_format="b64_json",
        )
        response = await raw if inspect.isawaitable(raw) else raw
        return _base64_image(response)


def _field(value: object, name: str) -> object | None:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _proxy_error_text(error: object) -> str:
    parts = [str(error)]
    for name in ("type", "code", "message", "param", "detail"):
        value = _field(error, name)
        if isinstance(value, str) and value:
            parts.append(value)
    return " ".join(parts).casefold()


def _proxy_status_code(error: object) -> int | None:
    for candidate in (error, _field(error, "response")):
        value = _field(candidate, "status_code")
        if value is None:
            value = _field(candidate, "status")
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _is_custom_size_rejection(error: object, *, size: str) -> bool:
    """Recognize only a proxy rejection of the preferred custom canvas.

    The fallback is intentionally not a generic retry policy.  Missing auth,
    timeouts, provider errors, and malformed image data must surface as their
    original failure after one request.  A status-bearing 4xx error or an
    explicitly invalid/unsupported stream error mentioning image dimensions
    is narrow enough to authorize the one configured compatibility fallback.
    """

    if size != DEFAULT_BACKGROUND_IMAGE_SIZE:
        return False
    text = _proxy_error_text(error)
    mentions_size = any(token in text for token in ("size", "resolution", "dimension"))
    rejects_value = any(
        token in text
        for token in ("invalid", "unsupported", "not allowed", "unrecognized", "unknown", "custom")
    )
    if not mentions_size or not rejects_value:
        return False
    status_code = _proxy_status_code(error)
    return status_code in {400, 422} or rejects_value


class _CustomSizeRejected(Exception):
    """Internal signal for the one explicit preferred-size compatibility fallback."""


def _decode_image_result(encoded: object) -> bytes:
    if not isinstance(encoded, str) or not encoded:
        raise ProviderError(
            "INVALID_RESPONSE",
            "Background provider returned no image",
            retryable=True,
        )
    if "," in encoded and encoded.startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError, TypeError) as error:
        raise ProviderError(
            "INVALID_RESPONSE",
            "Background provider returned invalid image data",
            retryable=True,
        ) from error


class CodexProxyBackgroundGenerator(LiveBackgroundGenerator):
    """Generate a PNG through Codex Proxy's Responses image tool.

    Codex Proxy's ChatGPT-account route does not expose the regular Images
    API.  It emits an ``image_generation_call`` item from a Responses SSE
    stream instead, so this adapter extracts only that item's base64 result.
    """

    def __init__(
        self,
        client: CodexProxyImageClient,
        model: str = "gpt-5.6-luna",
        *,
        size: str = DEFAULT_BACKGROUND_IMAGE_SIZE,
        quality: str = DEFAULT_BACKGROUND_IMAGE_QUALITY,
        timeout_seconds: float = BACKGROUND_GENERATION_TIMEOUT_SECONDS,
    ) -> None:
        if not isinstance(model, str) or not model.strip():
            raise ProviderError("INVALID_INPUT", "Background model must be non-empty", retryable=False)
        if size not in BACKGROUND_IMAGE_SIZES:
            raise ProviderError("INVALID_INPUT", "Background image size is not allowed", retryable=False)
        if quality not in BACKGROUND_IMAGE_QUALITIES:
            raise ProviderError("INVALID_INPUT", "Background image quality is not allowed", retryable=False)
        self._responses_client = client
        self._model = model.strip()
        self._size = size
        self._quality = quality
        super().__init__(self._generate_prompt, timeout_seconds=timeout_seconds)

    async def _generate_prompt(self, prompt: str) -> bytes:
        try:
            return await self._generate_prompt_once(prompt, size=self._size, quality=self._quality)
        except _CustomSizeRejected:
            # This is the sole compatibility fallback: one preferred custom
            # canvas rejection becomes one explicit 1024x1536/high request.
            # It is not a retry loop and is never used for other failures.
            return await self._generate_prompt_once(
                prompt,
                size=BACKGROUND_IMAGE_FALLBACK_SIZE,
                quality=BACKGROUND_IMAGE_FALLBACK_QUALITY,
            )

    async def _generate_prompt_once(self, prompt: str, *, size: str, quality: str) -> bytes:
        try:
            stream = await self._responses_client.create(
                model=self._model,
                store=False,
                stream=True,
                input=[
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": prompt}],
                    }
                ],
                tools=[_image_generation_tool(size=size, quality=quality)],
            )
        except Exception as error:
            if _is_custom_size_rejection(error, size=size):
                raise _CustomSizeRejected from error
            raise
        encoded: object | None = None
        try:
            async for event in stream:  # type: ignore[union-attr]
                event_type = getattr(event, "type", "")
                if event_type == "error":
                    if _is_custom_size_rejection(_field(event, "error") or event, size=size):
                        raise _CustomSizeRejected
                    raise ProviderError(
                        "UNAVAILABLE",
                        "Codex Proxy image generation failed",
                        retryable=True,
                    )
                if event_type != "response.output_item.done":
                    continue
                item = _field(event, "item")
                if _field(item, "type") == "image_generation_call":
                    encoded = _field(item, "result")
                    if encoded is not None:
                        break
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                result = close()
                if inspect.isawaitable(result):
                    await result
        return _decode_image_result(encoded)


# Descriptive alias for callers that name the underlying OpenAI API.
OpenAIImagesBackgroundGenerator = OpenAIBackgroundGenerator


class UnavailableBackgroundGenerator:
    async def generate(self, style_id: str | BackgroundGenerationInput) -> BackgroundResult:
        try:
            _input(style_id)
        except ProviderError as error:
            return BackgroundResult.failure(error)
        return BackgroundResult.failure(ProviderError("UNAVAILABLE", "Live background provider is unavailable", retryable=True))


class HttpBackgroundGenerator(LiveBackgroundGenerator):
    """HTTP adapter posting exactly ``{"prompt": fixed_text}``."""

    def __init__(self, endpoint: str, timeout_seconds: float = 60.0) -> None:
        if not isinstance(endpoint, str):
            raise ValueError("background endpoint must be an absolute http(s) URL")
        parsed = urlsplit(endpoint.strip())
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError("background endpoint must be an absolute http(s) URL")
        timeout_seconds = _validated_timeout(
            timeout_seconds,
            name="background timeout",
            maximum=120.0,
        )
        self.endpoint = endpoint.strip()
        self.timeout_seconds = timeout_seconds
        super().__init__(self._request_prompt, timeout_seconds=timeout_seconds)

    async def _request_prompt(self, prompt: str) -> bytes:
        def request() -> bytes:
            try:
                response = urlopen(
                    Request(
                        self.endpoint,
                        data=json.dumps({"prompt": prompt}).encode("utf-8"),
                        headers={"content-type": "application/json"},
                        method="POST",
                    ),
                    timeout=self.timeout_seconds,
                )
                try:
                    result = response.read(MAX_BACKGROUND_PNG_BYTES + 1)
                finally:
                    close = getattr(response, "close", None)
                    if callable(close):
                        close()
                if len(result) > MAX_BACKGROUND_PNG_BYTES:
                    raise ProviderError(
                        "INVALID_RESPONSE",
                        "Background provider returned an oversized response",
                        retryable=True,
                    )
                return result
            except TimeoutError as error:
                raise ProviderError("TIMEOUT", "Background provider timed out", retryable=True) from error
            except URLError as error:
                if isinstance(getattr(error, "reason", None), TimeoutError):
                    raise ProviderError("TIMEOUT", "Background provider timed out", retryable=True) from error
                raise ProviderError("UNAVAILABLE", "Background provider is unavailable", retryable=True) from error
            except OSError as error:
                raise ProviderError("UNAVAILABLE", "Background provider is unavailable", retryable=True) from error

        return await asyncio.to_thread(request)


def create_background_generator(
    provider_mode: BackendSettings | str | None = None,
    *,
    mode: str | None = None,
    live_generator: BackgroundGenerator | None = None,
    live_client: TextPromptGenerator | PromptGeneratorCallable | None = None,
) -> BackgroundGenerator:
    """Construct only the explicitly selected provider; fixture is default."""
    selected = mode if mode is not None else provider_mode
    if isinstance(selected, BackendSettings):
        settings = selected
    else:
        settings = BackendSettings.from_env(provider_mode=selected or None)
    if settings.provider_mode.value == "fixture":
        return FixtureBackgroundGenerator()
    if settings.provider_mode.value != "live":
        raise ProviderError("INVALID_INPUT", "PROVIDER_MODE must be fixture or live", retryable=False)
    if live_generator is not None:
        return live_generator
    if live_client is not None:
        return LiveBackgroundGenerator(live_client)
    if settings.background_generator_url:
        return HttpBackgroundGenerator(settings.background_generator_url)
    if settings.openai_api_key:
        try:
            from openai import AsyncOpenAI  # type: ignore[import-not-found]

            kwargs: dict[str, object] = {
                "api_key": settings.openai_api_key,
                "max_retries": settings.openai_max_retries,
            }
            if settings.openai_base_url:
                kwargs["base_url"] = settings.openai_base_url
            sdk_client = AsyncOpenAI(**kwargs)
            if settings.openai_base_url:
                return CodexProxyBackgroundGenerator(
                    sdk_client.responses,
                    settings.vision_guidance_model,
                    size=settings.background_image_size,
                    quality=settings.background_image_quality,
                )
            return OpenAIBackgroundGenerator(
                sdk_client.images,
                settings.background_model,
                size=settings.background_image_size,
                quality=settings.background_image_quality,
            )
        except (ImportError, TypeError, ValueError):
            return UnavailableBackgroundGenerator()
        except Exception:
            return UnavailableBackgroundGenerator()
    return UnavailableBackgroundGenerator()


__all__ = [
    "BACKGROUND_PROMPTS", "BACKGROUND_STYLE_IDS", "BACKGROUND_STYLE_ID_MAX_BYTES",
    "FIXED_PROMPTS", "STYLE_PROMPTS",
    "BackgroundContractError", "BackgroundGenerationInput", "BackgroundGenerator",
    "BackgroundInput", "BackgroundPngInfo", "BackgroundProviderError", "BackgroundResult",
    "BackgroundStyleId", "FixtureBackgroundGenerator", "HttpBackgroundGenerator",
    "BACKGROUND_GENERATION_TIMEOUT_SECONDS",
    "LiveBackgroundGenerator", "MAX_BACKGROUND_DIMENSION", "MAX_BACKGROUND_PNG_BYTES",
    "CodexProxyBackgroundGenerator", "CodexProxyImageClient",
    "OpenAIBackgroundGenerator", "OpenAIImageClient", "OpenAIImagesBackgroundGenerator",
    "PNG_SIGNATURE", "ProviderError", "TextPromptGenerator", "UnavailableBackgroundGenerator",
    "background_prompt", "create_background_generator", "validate_background_png", "validate_style_id",
]
