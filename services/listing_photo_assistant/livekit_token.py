"""Short-lived, least-privilege LiveKit access tokens.

Only the signed token and public room metadata cross the browser boundary.
LiveKit API credentials remain in this Python process and are never returned.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from functools import lru_cache
from typing import Any, Final
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictStr


DEFAULT_TOKEN_TTL_SECONDS: Final[int] = 90
HARD_MAX_TOKEN_TTL_SECONDS: Final[int] = 300
DEFAULT_CONFIGURED_MAX_TTL_SECONDS: Final[int] = HARD_MAX_TOKEN_TTL_SECONDS
_SESSION_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
_ROOM_PREFIX: Final[str] = "listing-photo-session-"


class LiveKitConfigurationError(RuntimeError):
    """Raised when the server cannot safely issue a LiveKit token."""


class LiveKitTokenRequest(BaseModel):
    sessionId: StrictStr = Field(min_length=1, max_length=96)
    model_config = ConfigDict(extra="forbid")


class LiveKitTokenResponse(BaseModel):
    token: str
    participantIdentity: str
    roomName: str
    expiresAt: int
    livekitUrl: str


@dataclass(frozen=True, slots=True)
class LiveKitConfig:
    api_key: str = field(repr=False)
    api_secret: str = field(repr=False)
    url: str
    token_ttl_seconds: int = DEFAULT_TOKEN_TTL_SECONDS
    max_token_ttl_seconds: int = DEFAULT_CONFIGURED_MAX_TTL_SECONDS

    def __post_init__(self) -> None:
        for name, value in (("api_key", self.api_key), ("api_secret", self.api_secret), ("url", self.url)):
            if not isinstance(value, str):
                raise LiveKitConfigurationError(f"LiveKit {name} must be a string")
        for name, value in (
            ("token_ttl_seconds", self.token_ttl_seconds),
            ("max_token_ttl_seconds", self.max_token_ttl_seconds),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise LiveKitConfigurationError(f"{name} must be a positive integer")

    @classmethod
    def from_env(cls) -> "LiveKitConfig":
        return cls(
            api_key=os.environ.get("LIVEKIT_API_KEY", ""),
            api_secret=os.environ.get("LIVEKIT_API_SECRET", ""),
            url=os.environ.get("LIVEKIT_URL", ""),
            token_ttl_seconds=_read_positive_int_env(
                "LIVEKIT_TOKEN_TTL_SECONDS", DEFAULT_TOKEN_TTL_SECONDS
            ),
            max_token_ttl_seconds=_read_positive_int_env(
                "LIVEKIT_TOKEN_MAX_TTL_SECONDS", DEFAULT_CONFIGURED_MAX_TTL_SECONDS
            ),
        )

    def effective_ttl_seconds(self) -> int:
        return min(
            max(1, self.token_ttl_seconds),
            max(1, self.max_token_ttl_seconds),
            HARD_MAX_TOKEN_TTL_SECONDS,
        )

    def validate_for_issuance(self) -> None:
        if not self.api_key or not self.api_secret or not self.url:
            raise LiveKitConfigurationError("LiveKit credentials are not configured")
        if not _is_supported_livekit_url(self.url):
            raise LiveKitConfigurationError("LIVEKIT_URL must use https or wss")


def _read_positive_int_env(name: str, default: int) -> int:
    raw_value = os.environ.get(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise LiveKitConfigurationError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise LiveKitConfigurationError(f"{name} must be a positive integer")
    return value


def _is_supported_livekit_url(value: str) -> bool:
    parsed = urlsplit(value.strip())
    return (
        parsed.scheme in {"wss", "https"}
        and bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
    )


def _validated_session_id(value: str) -> str:
    if not _SESSION_ID_PATTERN.fullmatch(value):
        raise ValueError("sessionId contains unsupported characters")
    return value


def room_name_for_session(session_id: str) -> str:
    return f"{_ROOM_PREFIX}{_validated_session_id(session_id)}"


def _new_participant_identity() -> str:
    return f"browser-{uuid.uuid4().hex}"


def _camera_track_source(_livekit_api: Any) -> str:
    # VideoGrants expects the wire string.  Passing rtc.TrackSource's integer
    # enum can serialize as [1] and fails the camera-only contract.
    return "camera"


def _sdk_token_has_required_claims(
    token: str,
    *,
    identity: str,
    room: str,
    ttl_seconds: int,
) -> int | None:
    """Validate SDK output before exposing it to the browser."""

    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload_bytes = base64.urlsafe_b64decode(parts[1] + ("=" * (-len(parts[1]) % 4)))
        payload = json.loads(payload_bytes)
        grants = payload.get("video")
        expires_at = payload.get("exp")
        not_before = payload.get("nbf", payload.get("iat"))
        valid = (
            isinstance(payload, dict)
            and payload.get("sub") == identity
            and isinstance(expires_at, int)
            and isinstance(not_before, int)
            and 0 < expires_at - not_before <= ttl_seconds
            and isinstance(grants, dict)
            and grants.get("roomJoin") is True
            and grants.get("room") == room
            and grants.get("canPublish") is True
            and grants.get("canSubscribe") is False
            and grants.get("canPublishData") is True
            and grants.get("canPublishSources") == ["camera"]
        )
        return expires_at if valid else None
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
        return None


def _sdk_hs256_token(
    *, config: LiveKitConfig, identity: str, room: str, ttl_seconds: int
) -> tuple[str, int]:
    try:
        from livekit import api as livekit_api  # type: ignore[import-not-found]
    except ImportError:
        raise LiveKitConfigurationError("livekit-api is not installed") from None

    try:
        grants = livekit_api.VideoGrants(
            room_join=True,
            room=room,
            can_publish=True,
            can_subscribe=False,
            can_publish_data=True,
            can_publish_sources=[_camera_track_source(livekit_api)],
        )
        access_token = (
            livekit_api.AccessToken(config.api_key, config.api_secret)
            .with_identity(identity)
            .with_ttl(timedelta(seconds=ttl_seconds))
            .with_grants(grants)
        )
        token = access_token.to_jwt()
        expires_at = _sdk_token_has_required_claims(
            token, identity=identity, room=room, ttl_seconds=ttl_seconds
        )
        if expires_at is None:
            raise LiveKitConfigurationError(
                "livekit-api produced incompatible token claims"
            )
        return token, expires_at
    except LiveKitConfigurationError:
        raise
    except Exception:
        # SDK details may contain deployment values; fail closed without
        # returning or logging them.
        raise LiveKitConfigurationError("livekit-api token generation failed") from None


def mint_livekit_token(
    *, config: LiveKitConfig, identity: str, room: str
) -> tuple[str, int]:
    config.validate_for_issuance()
    return _sdk_hs256_token(
        config=config,
        identity=identity,
        room=room,
        ttl_seconds=config.effective_ttl_seconds(),
    )


@lru_cache(maxsize=1)
def get_livekit_config() -> LiveKitConfig:
    """Resolve fallback configuration once, never once per request."""

    return LiveKitConfig.from_env()


def issue_livekit_token(
    payload: LiveKitTokenRequest,
    config: LiveKitConfig = Depends(get_livekit_config),
) -> LiveKitTokenResponse:
    try:
        room = room_name_for_session(payload.sessionId)
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid_session_id") from None

    identity = _new_participant_identity()
    try:
        token, expires_at = mint_livekit_token(
            config=config, identity=identity, room=room
        )
    except LiveKitConfigurationError:
        raise HTTPException(status_code=503, detail="livekit_unavailable") from None

    return LiveKitTokenResponse(
        token=token,
        participantIdentity=identity,
        roomName=room,
        expiresAt=expires_at,
        livekitUrl=config.url,
    )


livekit_token_router = APIRouter()
livekit_token_router.add_api_route(
    "/api/livekit-token",
    issue_livekit_token,
    methods=["POST"],
    response_model=LiveKitTokenResponse,
    response_model_by_alias=True,
)


__all__ = [
    "DEFAULT_TOKEN_TTL_SECONDS",
    "HARD_MAX_TOKEN_TTL_SECONDS",
    "LiveKitConfig",
    "LiveKitConfigurationError",
    "LiveKitTokenRequest",
    "LiveKitTokenResponse",
    "get_livekit_config",
    "issue_livekit_token",
    "livekit_token_router",
    "mint_livekit_token",
    "room_name_for_session",
]
