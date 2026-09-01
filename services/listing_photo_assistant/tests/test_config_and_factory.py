from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from services.listing_photo_assistant.config import BackendSettings, ConfigurationError
from services.listing_photo_assistant.app import create_app
from services.listing_photo_assistant.providers.image_utils import encode_grayscale_png
from services.listing_photo_assistant.providers import background
from services.listing_photo_assistant.providers.shot_assessor import (
    RequestedShot,
    ShotAssessorInput,
    AssessmentImage,
)
from services.listing_photo_assistant.providers.shot_assessor_factory import (
    FixtureShotAssessor,
    create_shot_assessor,
)


def test_fixture_mode_is_the_safe_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROVIDER_MODE", raising=False)
    monkeypatch.delenv("API_PORT", raising=False)

    settings = BackendSettings.from_env()

    assert settings.provider_mode == "fixture"
    assert settings.api_port == 3001
    assert settings.shot_assessor_model == "gpt-5.6-luna"
    assert settings.background_model == "gpt-image-2"
    assert settings.llm_reasoning_effort == "none"
    assert settings.openai_max_retries == 0
    assert settings.guidance_cadence_seconds == 2.0
    assert settings.guidance_max_calls_per_session == 12
    assert settings.background_image_quality == "high"
    assert settings.background_image_size == "1200x1600"


@pytest.mark.parametrize("size", ["1024x1024", "1536x1024", "1024x1536", "1200x1600"])
def test_background_image_size_accepts_preferred_and_legacy_canvases(size: str) -> None:
    settings = BackendSettings(background_image_size=size)

    assert settings.background_image_size == size


def test_provider_mode_is_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROVIDER_MODE", "live")
    assert BackendSettings.from_env().provider_mode == "live"

    monkeypatch.setenv("PROVIDER_MODE", "automatic-fixture-fallback")
    with pytest.raises(ConfigurationError, match="PROVIDER_MODE"):
        BackendSettings.from_env()


@pytest.mark.parametrize(
    "name,value",
    [
        ("LIVEKIT_TOKEN_TTL_SECONDS", "not-a-number"),
        ("LIVEKIT_TOKEN_MAX_TTL_SECONDS", "0"),
        ("LLM_REASONING_EFFORT", "ultra-cheap"),
        ("LLM_MAX_OUTPUT_TOKENS", "0"),
        ("OPENAI_MAX_RETRIES", "-1"),
        ("GUIDANCE_CADENCE_SECONDS", "-1"),
        ("GUIDANCE_MAX_CALLS_PER_SESSION", "0"),
        ("GUIDANCE_FAILURE_COOLDOWN_SECONDS", "nan"),
        ("BACKGROUND_IMAGE_QUALITY", "draft"),
        ("BACKGROUND_IMAGE_SIZE", "512x512"),
    ],
)
def test_invalid_numeric_environment_values_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
) -> None:
    monkeypatch.setenv(name, value)

    with pytest.raises(ConfigurationError, match=name):
        BackendSettings.from_env()


def test_settings_snapshot_is_immutable_and_hides_credentials() -> None:
    settings = BackendSettings(
        provider_mode="live",
        api_host="127.0.0.1",
        api_port=3001,
        openai_api_key="openai-secret",
        livekit_api_key="livekit-key",
        livekit_api_secret="livekit-secret",
    )

    assert "openai-secret" not in repr(settings)
    assert "livekit-secret" not in repr(settings)
    with pytest.raises(AttributeError):
        settings.provider_mode = "fixture"  # type: ignore[misc]


def test_app_uses_one_explicit_settings_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = BackendSettings(provider_mode="fixture")
    app = create_app(settings)
    monkeypatch.setenv("PROVIDER_MODE", "live")
    monkeypatch.setenv("OPENAI_API_KEY", "unexpected-secret")

    image = encode_grayscale_png(2, 2, lambda x, y: 255 if (x + y) % 2 == 0 else 0)
    with TestClient(app) as client:
        response = client.post(
            "/api/analyze-shot",
            data={"requestedShot": "front"},
            files={
                "file": ("capture.png", image, "image/png")
            },
        )

    assert app.state.settings is settings
    assert response.status_code == 200
    assert response.json()["shotType"] == "front"


@pytest.mark.asyncio
async def test_fixture_assessor_is_deterministic_and_does_not_need_credentials() -> None:
    assessor = create_shot_assessor(BackendSettings("fixture", "127.0.0.1", 3001))
    assert isinstance(assessor, FixtureShotAssessor)

    result = await assessor.assess(
        ShotAssessorInput(AssessmentImage(b"jpeg"), RequestedShot.FRONT)
    )

    assert result.to_payload() == {
        "shotType": "front",
        "quality": "ok",
        "issues": [],
        "missingShots": ["back", "tag"],
        "nextAction": "REQUEST_NEXT",
    }


def test_live_mode_does_not_silently_fallback_to_fixture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "")
    assessor = create_shot_assessor(BackendSettings("live", "127.0.0.1", 3001))
    assert not isinstance(assessor, FixtureShotAssessor)


def test_proxy_background_factory_preserves_top_level_model_and_passes_quality(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import openai

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)
            self.responses = object()

    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    settings = BackendSettings(
        provider_mode="live",
        openai_api_key="test-key",
        openai_base_url="http://proxy.invalid/v1",
        vision_guidance_model="gpt-5.6-luna",
        background_image_size="1200x1600",
        background_image_quality="high",
    )

    provider = background.create_background_generator(settings)

    assert isinstance(provider, background.CodexProxyBackgroundGenerator)
    assert provider._model == "gpt-5.6-luna"  # type: ignore[attr-defined]
    assert provider._size == "1200x1600"  # type: ignore[attr-defined]
    assert provider._quality == "high"  # type: ignore[attr-defined]
    assert captured == {
        "api_key": "test-key",
        "max_retries": 0,
        "base_url": "http://proxy.invalid/v1",
    }
