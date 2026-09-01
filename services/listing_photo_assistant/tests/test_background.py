from __future__ import annotations

import asyncio
import base64
import binascii
import json
import struct

import pytest

from services.listing_photo_assistant.providers import background


def run(coro):
    return asyncio.run(coro)


def test_fixture_is_first_class_and_returns_validated_png() -> None:
    provider = background.create_background_generator()
    result = run(provider.generate("studio_white"))

    assert result.success is True
    assert result.error is None
    assert result.background_png is not None
    assert background.validate_background_png(result.background_png).width == result.width
    assert result.background_png.startswith(background.PNG_SIGNATURE)


def test_style_is_strict_and_input_failures_are_data_free() -> None:
    provider = background.FixtureBackgroundGenerator()

    result = run(provider.generate("not-allowed"))

    assert result.success is False
    assert result.background_png is None
    assert result.error is not None
    assert result.error.code == "INVALID_INPUT"
    with pytest.raises(background.ProviderError):
        background.validate_style_id("x" * 65)
    with pytest.raises(background.ProviderError):
        background.BackgroundGenerationInput.from_mapping({"styleId": "studio_white", "image": b"secret"})


def test_live_client_receives_only_the_fixed_text_prompt() -> None:
    calls: list[object] = []
    fixture_png = run(background.FixtureBackgroundGenerator().generate("warm_neutral")).background_png

    # A request spy with a one-argument interface makes binary fields
    # impossible at the type and call boundary.
    class Spy:
        async def generate(self, prompt: str) -> bytes:
            calls.append(prompt)
            return fixture_png  # type: ignore[return-value]

    result = run(background.LiveBackgroundGenerator(Spy()).generate("warm_neutral"))

    assert result.success is True
    assert calls == [background.background_prompt("warm_neutral")]
    assert all(isinstance(value, str) for value in calls)


def test_openai_image_adapter_uses_portrait_high_quality_defaults() -> None:
    fixture = run(background.FixtureBackgroundGenerator().generate("studio_white"))
    image = fixture.background_png
    assert image is not None
    calls: list[dict[str, object]] = []

    class Response:
        data = [type("Image", (), {"b64_json": base64.b64encode(image).decode("ascii")})()]

    class Spy:
        async def generate(self, **kwargs: object) -> Response:
            calls.append(kwargs)
            return Response()

    result = run(background.OpenAIBackgroundGenerator(Spy()).generate("studio_white"))

    assert result.success is True
    assert calls == [
        {
            "model": "gpt-image-2",
            "prompt": background.background_prompt("studio_white"),
            "size": "1200x1600",
            "quality": "high",
            "output_format": "png",
            "background": "opaque",
            "response_format": "b64_json",
        }
    ]


def test_codex_proxy_image_adapter_extracts_image_generation_call() -> None:
    fixture = run(background.FixtureBackgroundGenerator().generate("studio_white"))
    image = fixture.background_png
    assert image is not None

    class Event:
        def __init__(self, event_type: str, item: object | None = None) -> None:
            self.type = event_type
            self.item = item

    class ImageCall:
        type = "image_generation_call"
        result = base64.b64encode(image).decode("ascii")

    class Stream:
        def __init__(self) -> None:
            self.closed = False

        def __aiter__(self):
            async def events():
                yield Event("response.output_item.added")
                yield Event("response.output_item.done", ImageCall())

            return events()

        async def close(self) -> None:
            self.closed = True

    class Spy:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []
            self.stream = Stream()

        async def create(self, **kwargs: object) -> Stream:
            self.calls.append(kwargs)
            return self.stream

    client = Spy()
    result = run(background.CodexProxyBackgroundGenerator(client).generate("studio_white"))

    assert result.success is True
    assert result.background_png == image
    assert client.calls == [
        {
            "model": "gpt-5.6-luna",
            "store": False,
            "stream": True,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": background.background_prompt("studio_white"),
                        }
                    ],
                }
            ],
            "tools": [
                {
                    "type": "image_generation",
                    "size": "1200x1600",
                    "quality": "high",
                    "output_format": "png",
                    "background": "opaque",
                }
            ],
        }
    ]
    assert client.stream.closed is True


def test_codex_proxy_falls_back_once_only_for_preferred_custom_size_rejection() -> None:
    fixture = run(background.FixtureBackgroundGenerator().generate("studio_white"))
    image = fixture.background_png
    assert image is not None

    class SizeRejectedError(Exception):
        status_code = 400

        def __str__(self) -> str:
            return "unsupported image size 1200x1600"

    class Event:
        type = "response.output_item.done"

        class Item:
            type = "image_generation_call"
            result = base64.b64encode(image).decode("ascii")

        item = Item()

    class Stream:
        def __aiter__(self):
            async def events():
                yield Event()

            return events()

        async def close(self) -> None:
            return None

    class Spy:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        async def create(self, **kwargs: object) -> Stream:
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                raise SizeRejectedError()
            return Stream()

    client = Spy()
    result = run(background.CodexProxyBackgroundGenerator(client, quality="low").generate("studio_white"))

    assert result.success is True
    assert len(client.calls) == 2
    first_tool = client.calls[0]["tools"][0]  # type: ignore[index]
    fallback_tool = client.calls[1]["tools"][0]  # type: ignore[index]
    assert first_tool == {
        "type": "image_generation",
        "size": "1200x1600",
        "quality": "low",
        "output_format": "png",
        "background": "opaque",
    }
    assert fallback_tool == {
        "type": "image_generation",
        "size": "1024x1536",
        "quality": "high",
        "output_format": "png",
        "background": "opaque",
    }


def test_codex_proxy_does_not_retry_non_size_failures() -> None:
    class Spy:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **_kwargs: object) -> object:
            self.calls += 1
            raise RuntimeError("authentication failed")

    client = Spy()
    result = run(background.CodexProxyBackgroundGenerator(client).generate("studio_white"))

    assert result.success is False
    assert result.error is not None
    assert result.error.code == "PROVIDER_FAILURE"
    assert client.calls == 1


def test_unverified_live_output_is_a_failure_not_a_success() -> None:
    async def invalid_generator(prompt: str) -> bytes:
        assert isinstance(prompt, str)
        return background.PNG_SIGNATURE + b"not-a-png"

    result = run(background.LiveBackgroundGenerator(invalid_generator).generate("studio_white"))

    assert result.success is False
    assert result.background_png is None
    assert result.error is not None
    assert result.error.code == "INVALID_RESPONSE"


def test_live_failure_never_falls_back_to_fixture() -> None:
    async def failing_generator(prompt: str) -> bytes:
        raise OSError("upstream unavailable")

    result = run(background.LiveBackgroundGenerator(failing_generator).generate("studio_white"))

    assert result.success is False
    assert result.error is not None
    assert result.error.code == "PROVIDER_FAILURE"

    unavailable = run(background.create_background_generator("live").generate("studio_white"))
    assert unavailable.success is False
    assert unavailable.error is not None
    assert unavailable.error.code == "UNAVAILABLE"


def test_unavailable_provider_still_rejects_invalid_style() -> None:
    result = run(background.UnavailableBackgroundGenerator().generate("not-allowed"))

    assert result.success is False
    assert result.background_png is None
    assert result.error is not None
    assert result.error.code == "INVALID_INPUT"


def test_http_adapter_posts_only_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    fixture = run(background.FixtureBackgroundGenerator().generate("light_wood"))

    class Response:
        def read(self, _limit: int | None = None) -> bytes:
            return fixture.background_png or b""

    def request_spy(request: object, *, timeout: float) -> Response:
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(background, "urlopen", request_spy)
    result = run(background.HttpBackgroundGenerator("https://generator.invalid").generate("light_wood"))

    request = captured["request"]
    assert result.success is True
    assert set(json.loads(request.data.decode("utf-8"))) == {"prompt"}  # type: ignore[attr-defined]
    assert json.loads(request.data.decode("utf-8"))["prompt"] == background.background_prompt("light_wood")  # type: ignore[attr-defined]


def test_png_validator_rejects_bad_crc_and_oversized_dimensions() -> None:
    valid = run(background.FixtureBackgroundGenerator().generate("studio_white")).background_png
    assert valid is not None

    bad_crc = bytearray(valid)
    bad_crc[29] ^= 1
    with pytest.raises(background.ProviderError):
        background.validate_background_png(bytes(bad_crc))

    oversized = bytearray(valid)
    oversized[16:20] = struct.pack(">I", background.MAX_BACKGROUND_DIMENSION + 1)
    with pytest.raises(background.ProviderError):
        background.validate_background_png(bytes(oversized))


def test_png_validator_accepts_valid_ancillary_metadata_chunks() -> None:
    valid = run(background.FixtureBackgroundGenerator().generate("studio_white")).background_png
    assert valid is not None
    kind = b"caBX"
    payload = b"proxy-metadata"
    chunk = struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    ihdr_end = 8 + 4 + 4 + 13 + 4
    with_metadata = valid[:ihdr_end] + chunk + valid[ihdr_end:]

    info = background.validate_background_png(with_metadata)

    original = background.validate_background_png(valid)
    assert (info.width, info.height) == (original.width, original.height)
