from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest

from services.listing_photo_assistant.config import BackendSettings
from services.listing_photo_assistant.providers.errors import ProviderError
from services.listing_photo_assistant.providers.runtime import (
    ResponsesVisionGuidanceProvider,
    VISION_GUIDANCE_JSON_SCHEMA,
    create_provider_inference,
    create_vision_guidance_provider,
)
from services.listing_photo_assistant.providers.vision_guidance import (
    EncodedImage,
    GuidanceCode,
    GuidanceInput,
    GuidanceShot,
    VisionDecision,
)


@dataclass
class FakeResponse:
    output_text: str


class FakeResponsesClient:
    def __init__(self, output_text: str = '{"code":"READY","confidence":0.91}') -> None:
        self.output_text = output_text
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> FakeResponse:
        self.calls.append(kwargs)
        return FakeResponse(self.output_text)


def live_settings(**overrides: object) -> BackendSettings:
    values: dict[str, object] = {
        "provider_mode": "live",
        "openai_api_key": "test-key",
        "livekit_url": "wss://livekit.example.test",
        "livekit_api_key": "lk-key",
        "livekit_api_secret": "lk-secret",
    }
    values.update(overrides)
    return BackendSettings(**values)  # type: ignore[arg-type]


def test_live_provider_uses_strict_schema_and_store_false() -> None:
    client = FakeResponsesClient()
    provider = ResponsesVisionGuidanceProvider(client, "vision-model")

    result = asyncio.run(
        provider.analyze(
            GuidanceInput(
                frame=EncodedImage(b"jpeg-frame"),
                requested_shot=GuidanceShot.FRONT,
            )
        )
    )

    assert result == VisionDecision(GuidanceCode.READY, 0.91)
    request = client.calls[0]
    assert request["store"] is False
    assert request["model"] == "vision-model"
    assert request["reasoning"] == {"effort": "none"}
    assert request["max_output_tokens"] == 256
    assert request["text"] == {
        "format": {
            "type": "json_schema",
            "name": "vision_guidance",
            "strict": True,
            "schema": VISION_GUIDANCE_JSON_SCHEMA,
        }
    }
    assert "data:image/jpeg;base64," in str(request["input"])


def test_live_provider_rejects_model_unavailable_code() -> None:
    provider = ResponsesVisionGuidanceProvider(
        FakeResponsesClient('{"code":"AGENT_UNAVAILABLE","confidence":0}'),
        "vision-model",
    )

    with pytest.raises(ProviderError) as error:
        asyncio.run(
            provider.analyze(
                GuidanceInput(
                    frame=EncodedImage(b"frame"),
                    requested_shot=GuidanceShot.FRONT,
                )
            )
        )

    assert error.value.code.value == "INVALID_RESPONSE"


def test_runtime_factory_requires_openai_key_in_live_mode() -> None:
    with pytest.raises(ProviderError) as error:
        create_vision_guidance_provider(
            BackendSettings(
                provider_mode="live",
                livekit_url="wss://livekit.example.test",
                livekit_api_key="lk-key",
                livekit_api_secret="lk-secret",
            )
        )

    assert error.value.code.value == "UNAVAILABLE"
    assert "test-key" not in str(error.value)


def test_runtime_factory_and_inference_are_explicitly_fixture_or_live() -> None:
    fixture = create_vision_guidance_provider(BackendSettings())
    assert asyncio.run(
        fixture.analyze(
            GuidanceInput(
                frame=EncodedImage(b"frame"), requested_shot=GuidanceShot.MEASUREMENT
            )
        )
    ).code is GuidanceCode.PLACE_MARKER

    client = FakeResponsesClient()
    live = create_vision_guidance_provider(live_settings(), live_client=client)
    inference = create_provider_inference(live, requested_shot="back")
    result = asyncio.run(inference(b"frame"))
    assert result.code is GuidanceCode.READY
    assert client.calls[0]["store"] is False
    assert client.calls[0]["reasoning"] == {"effort": "none"}
