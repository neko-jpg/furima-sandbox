from __future__ import annotations

import base64
import hashlib
import hmac
import json

from fastapi.testclient import TestClient

from services.listing_photo_assistant.app import create_app


def _decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + ("=" * (-len(segment) % 4)))


def test_livekit_token_is_signed_camera_only_and_secret_free(monkeypatch) -> None:
    secret = "test-secret-" + hashlib.sha256(b"fixture").hexdigest()
    monkeypatch.setenv("LIVEKIT_API_KEY", "test-api-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", secret)
    monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.invalid")

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/livekit-token", json={"sessionId": "session-token-test"}
        )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "token",
        "participantIdentity",
        "roomName",
        "expiresAt",
        "livekitUrl",
    }
    assert secret not in response.text

    header_part, body_part, signature_part = payload["token"].split(".")
    signed = f"{header_part}.{body_part}".encode("ascii")
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).digest()
    assert hmac.compare_digest(_decode(signature_part), expected)
    assert json.loads(_decode(header_part))["alg"] == "HS256"
    claims = json.loads(_decode(body_part))
    grants = claims["video"]
    assert claims["sub"] == payload["participantIdentity"]
    assert claims["exp"] == payload["expiresAt"]
    assert grants == {
        "roomJoin": True,
        "room": payload["roomName"],
        "canPublish": True,
        "canSubscribe": False,
        "canPublishData": True,
        "canPublishSources": ["camera"],
    }


def test_token_endpoint_fails_closed_without_server_credentials(monkeypatch) -> None:
    for name in ("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL"):
        monkeypatch.delenv(name, raising=False)

    with TestClient(create_app()) as client:
        response = client.post(
            "/api/livekit-token", json={"sessionId": "session-no-secret"}
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "livekit_unavailable"}
