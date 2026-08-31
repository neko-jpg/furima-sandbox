from __future__ import annotations

import asyncio
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
