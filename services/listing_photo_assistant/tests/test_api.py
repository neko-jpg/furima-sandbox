from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from fastapi import HTTPException
from fastapi.testclient import TestClient

from services.listing_photo_assistant.app import create_app
from services.listing_photo_assistant.image_normalization import NormalizedAnalysisImage
from services.listing_photo_assistant.image_routes import (
    get_garment_masker,
    get_measurement_image_normalizer,
    get_measurement_line_provider,
    get_measurement_timeout_seconds,
)
from services.listing_photo_assistant.providers.background import validate_background_png
from services.listing_photo_assistant.providers.image_utils import encode_grayscale_png
from services.listing_photo_assistant.providers.mask import validate_mask_png
from services.listing_photo_assistant.providers.measurement import MeasurementLineInput


def _fixture_png() -> bytes:
    return encode_grayscale_png(2, 2, lambda x, y: 255 if (x + y) % 2 == 0 else 0)


@dataclass
class _RecordingMeasurementProvider:
    result: object
    requests: list[MeasurementLineInput] = field(default_factory=list)

    async def suggest(self, input: MeasurementLineInput) -> object:
        self.requests.append(input)
        return self.result


class _HangingMeasurementProvider:
    async def suggest(self, input: MeasurementLineInput) -> object:
        del input
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


class _LeakyMeasurementProvider:
    async def suggest(self, input: MeasurementLineInput) -> object:
        del input
        raise HTTPException(status_code=418, detail={"secret": "must not escape"})


class _LeakyGarmentMasker:
    async def mask(self, input):
        del input
        from services.listing_photo_assistant.providers.mask import ProviderError

        raise ProviderError("UNAVAILABLE", "upstream secret: https://internal.example", retryable=True)


class _CanonicalMeasurementNormalizer:
    def normalize(self, data: bytes, mime_type: str) -> NormalizedAnalysisImage:
        del data, mime_type
        return NormalizedAnalysisImage(b"canonical-analysis-copy", 2, 2)


def test_health_preserves_contract() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"


def test_api_boundary_headers_are_consistent_and_request_id_is_bounded() -> None:
    with TestClient(create_app()) as client:
        echoed = client.get("/api/health", headers={"X-Request-ID": "trace-123"})
        generated = client.get("/api/health", headers={"X-Request-ID": "x" * 129})

    assert echoed.headers["x-request-id"] == "trace-123"
    assert echoed.headers["cache-control"] == "no-store"
    assert echoed.headers["x-content-type-options"] == "nosniff"
    assert 1 <= len(generated.headers["x-request-id"]) <= 128
    assert generated.headers["x-request-id"] != "x" * 129
    assert generated.headers["cache-control"] == "no-store"
    assert generated.headers["x-content-type-options"] == "nosniff"


def test_cors_allows_the_browser_correlation_header() -> None:
    with TestClient(create_app()) as client:
        preflight = client.options(
            "/api/analyze-shot",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type, x-request-id",
            },
        )
        actual = client.get(
            "/api/health",
            headers={"Origin": "http://127.0.0.1:3000"},
        )

    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert "x-request-id" in preflight.headers["access-control-allow-headers"].lower()
    assert actual.status_code == 200
    assert actual.headers["access-control-expose-headers"].lower() == "x-request-id"


def test_fixture_analyze_shot_accepts_only_front_back_tag() -> None:
    with TestClient(create_app()) as client:
        for requested_shot, missing, next_action in (
            ("front", ["back", "tag"], "REQUEST_NEXT"),
            ("back", ["tag"], "REQUEST_NEXT"),
            ("tag", [], "COMPLETE"),
        ):
            response = client.post(
                "/api/analyze-shot",
                data={"requestedShot": requested_shot},
                files={"file": ("capture.png", _fixture_png(), "image/png")},
            )
            assert response.status_code == 200
            assert response.json() == {
                "shotType": requested_shot,
                "quality": "ok",
                "issues": [],
                "missingShots": missing,
                "nextAction": next_action,
            }


def test_analyze_shot_rejects_measurement_and_unsupported_mime() -> None:
    with TestClient(create_app()) as client:
        measurement = client.post(
            "/api/analyze-shot",
            data={"requestedShot": "measurement"},
            files={"file": ("capture.jpg", b"jpeg-bytes", "image/jpeg")},
        )
        unsupported = client.post(
            "/api/analyze-shot",
            data={"requestedShot": "front"},
            files={"file": ("capture.txt", b"text", "text/plain")},
        )

    assert measurement.status_code == 422
    assert unsupported.status_code == 415
    assert unsupported.json()["detail"]["code"] == "INVALID_INPUT"


def test_fixture_measurement_returns_only_four_normalized_points() -> None:
    with TestClient(create_app()) as client:
        response = client.post(
            "/api/suggest-measurement-points",
            files={"file": ("measurement.png", _fixture_png(), "image/png")},
        )

    assert response.status_code == 200
    assert response.json() == {
        "lengthStart": {"x": 0.5, "y": 0.2},
        "lengthEnd": {"x": 0.5, "y": 0.82},
        "widthStart": {"x": 0.22, "y": 0.48},
        "widthEnd": {"x": 0.78, "y": 0.48},
    }


def test_measurement_route_normalizes_the_analysis_copy_and_echoes_request_id() -> None:
    provider = _RecordingMeasurementProvider(
        {
            "lengthStart": {"x": 0.5, "y": 0.2},
            "lengthEnd": {"x": 0.5, "y": 0.82},
            "widthStart": {"x": 0.22, "y": 0.48},
            "widthEnd": {"x": 0.78, "y": 0.48},
        }
    )
    app = create_app()
    app.dependency_overrides[get_measurement_line_provider] = lambda: provider
    app.dependency_overrides[get_measurement_image_normalizer] = _CanonicalMeasurementNormalizer

    with TestClient(app) as client:
        response = client.post(
            "/api/suggest-measurement-points",
            headers={"X-Request-ID": "measurement-retry-1"},
            files={"file": ("measurement.png", _fixture_png(), "image/png")},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] == "measurement-retry-1"
    assert len(provider.requests) == 1
    assert provider.requests[0].image.data == b"canonical-analysis-copy"
    assert provider.requests[0].image.mime_type == "image/png"
    assert (provider.requests[0].image.width, provider.requests[0].image.height) == (2, 2)


def test_measurement_timeout_is_a_finite_error_and_cancels_provider_task() -> None:
    app = create_app()
    app.dependency_overrides[get_measurement_line_provider] = lambda: _HangingMeasurementProvider()
    app.dependency_overrides[get_measurement_timeout_seconds] = lambda: 0.001

    with TestClient(app) as client:
        response = client.post(
            "/api/suggest-measurement-points",
            files={"file": ("measurement.png", _fixture_png(), "image/png")},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 504
    assert response.json()["detail"] == {
        "provider": "measurement-line",
        "code": "TIMEOUT",
        "message": "Measurement endpoint suggestion timed out",
        "retryable": True,
    }


def test_measurement_provider_http_exception_cannot_leak_details() -> None:
    app = create_app()
    app.dependency_overrides[get_measurement_line_provider] = lambda: _LeakyMeasurementProvider()

    with TestClient(app) as client:
        response = client.post(
            "/api/suggest-measurement-points",
            files={"file": ("measurement.png", _fixture_png(), "image/png")},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["detail"] == {
        "provider": "measurement-line",
        "code": "UNAVAILABLE",
        "message": "Measurement endpoint suggestion is unavailable",
        "retryable": True,
    }
    assert "secret" not in response.text


def test_image_provider_error_message_is_mapped_to_public_text() -> None:
    app = create_app()
    app.dependency_overrides[get_garment_masker] = lambda: _LeakyGarmentMasker()

    with TestClient(app) as client:
        response = client.post(
            "/api/remove-background",
            files={"file": ("front.png", _fixture_png(), "image/png")},
        )

    app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["detail"] == {
        "provider": "garment-masker",
        "code": "UNAVAILABLE",
        "message": "Provider is unavailable",
        "retryable": True,
    }
    assert "internal.example" not in response.text


def test_measurement_request_id_is_rejected_when_it_is_not_bounded() -> None:
    with TestClient(create_app()) as client:
        response = client.post(
            "/api/suggest-measurement-points",
            headers={"X-Request-ID": "x" * 201},
            files={"file": ("measurement.png", _fixture_png(), "image/png")},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_INPUT"


def test_fixture_mask_is_mask_only_and_background_is_style_allowlisted() -> None:
    source = _fixture_png()
    with TestClient(create_app()) as client:
        mask_response = client.post(
            "/api/remove-background",
            files={"file": ("front.png", source, "image/png")},
        )
        background_response = client.post(
            "/api/generate-background",
            json={"styleId": "warm_neutral"},
        )

    assert mask_response.status_code == 200
    assert mask_response.headers["content-type"].startswith("image/png")
    mask_info = validate_mask_png(mask_response.content, expected_size=(2, 2))
    assert mask_info.width == 2 and mask_info.height == 2
    assert mask_response.headers["cache-control"] == "no-store"

    assert background_response.status_code == 200
    assert background_response.headers["content-type"].startswith("image/png")
    background_info = validate_background_png(background_response.content)
    assert (background_info.width, background_info.height) == (768, 768)
    assert background_response.headers["cache-control"] == "no-store"


def test_background_rejects_unallowlisted_style_without_calling_provider() -> None:
    with TestClient(create_app()) as client:
        response = client.post(
            "/api/generate-background",
            json={"styleId": "include-product-image"},
        )

    assert response.status_code == 422


def test_live_mode_without_key_returns_safe_provider_error(
    monkeypatch,
) -> None:
    monkeypatch.setenv("PROVIDER_MODE", "live")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(create_app()) as client:
        response = client.post(
                "/api/analyze-shot",
                data={"requestedShot": "front"},
                files={"file": ("capture.png", _fixture_png(), "image/png")},
            )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "UNAVAILABLE"
