from __future__ import annotations

from fastapi.testclient import TestClient

from services.listing_photo_assistant.app import create_app
from services.listing_photo_assistant.providers.background import validate_background_png
from services.listing_photo_assistant.providers.image_utils import encode_grayscale_png
from services.listing_photo_assistant.providers.mask import validate_mask_png


def _fixture_png() -> bytes:
    return encode_grayscale_png(2, 2, lambda x, y: 255 if (x + y) % 2 == 0 else 0)


def test_health_preserves_contract() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"


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
