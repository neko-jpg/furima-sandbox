"""Immutable settings shared by the assistant HTTP API and Agent.

The process resolves environment variables once at its entrypoint.  Provider
factories receive this object afterwards, which prevents a request from
changing provider mode or credentials by mutating the process environment.
Secret fields are deliberately excluded from ``repr`` and are never part of
an HTTP response.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum


class SettingsError(ValueError):
    """Raised when process configuration is missing or invalid."""


class ProviderMode(str, Enum):
    FIXTURE = "fixture"
    LIVE = "live"

    @classmethod
    def parse(cls, value: object) -> "ProviderMode":
        if isinstance(value, cls):
            return value
        if not isinstance(value, str):
            raise SettingsError("PROVIDER_MODE must be fixture or live")
        try:
            return cls(value.strip().lower())
        except ValueError as error:
            raise SettingsError("PROVIDER_MODE must be fixture or live") from error


DEFAULT_CORS_ORIGINS = (
    "http://127.0.0.1:3000",
    "http://localhost:3000",
)
DEFAULT_SHOT_ASSESSOR_MODEL = "gpt-4.1-mini-2025-04-14"
DEFAULT_MEASUREMENT_LINE_MODEL = "gpt-4.1-mini-2025-04-14"
DEFAULT_VISION_GUIDANCE_MODEL = "gpt-4.1-mini-2025-04-14"
DEFAULT_BACKGROUND_MODEL = "gpt-image-1"


def _port(value: object) -> int:
    if isinstance(value, bool):
        raise SettingsError("API_PORT must be an integer between 1 and 65535")
    try:
        converted = int(value)
    except (TypeError, ValueError) as error:
        raise SettingsError("API_PORT must be an integer between 1 and 65535") from error
    if not 1 <= converted <= 65_535:
        raise SettingsError("API_PORT must be an integer between 1 and 65535")
    return converted


def _positive_int(value: object, *, field_name: str) -> int:
    try:
        converted = int(value)
    except (TypeError, ValueError) as error:
        raise SettingsError(f"{field_name} must be a positive integer") from error
    if isinstance(value, bool) or converted <= 0:
        raise SettingsError(f"{field_name} must be a positive integer")
    return converted


def _text(value: object, *, field_name: str, default: str = "") -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise SettingsError(f"{field_name} must be a string")
    return value.strip()


def _origins(value: object) -> tuple[str, ...]:
    if not isinstance(value, str):
        raise SettingsError("ASSISTANT_CORS_ORIGINS must be a comma-separated string")
    origins = tuple(item.strip() for item in value.split(",") if item.strip())
    if any(origin == "*" for origin in origins):
        raise SettingsError("ASSISTANT_CORS_ORIGINS must not contain a wildcard")
    return origins


@dataclass(frozen=True, slots=True)
class BackendSettings:
    """Resolved runtime configuration for all assistant providers."""

    provider_mode: ProviderMode = ProviderMode.FIXTURE
    api_host: str = "127.0.0.1"
    api_port: int = 3001
    assistant_cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS

    # Credentials are retained only in the process and hidden from repr.
    openai_api_key: str = field(default="", repr=False)
    openai_base_url: str = ""
    livekit_url: str = field(default="", repr=False)
    livekit_api_key: str = field(default="", repr=False)
    livekit_api_secret: str = field(default="", repr=False)

    shot_assessor_model: str = DEFAULT_SHOT_ASSESSOR_MODEL
    measurement_line_model: str = DEFAULT_MEASUREMENT_LINE_MODEL
    vision_guidance_model: str = DEFAULT_VISION_GUIDANCE_MODEL
    background_model: str = DEFAULT_BACKGROUND_MODEL
    rembg_url: str = ""
    background_generator_url: str = ""

    livekit_token_ttl_seconds: int = 90
    livekit_token_max_ttl_seconds: int = 300

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider_mode", ProviderMode.parse(self.provider_mode))

        host = _text(self.api_host, field_name="API_HOST")
        if not host:
            raise SettingsError("API_HOST must be a non-empty string")
        object.__setattr__(self, "api_host", host)
        object.__setattr__(self, "api_port", _port(self.api_port))

        origins = tuple(_text(origin, field_name="ASSISTANT_CORS_ORIGINS") for origin in self.assistant_cors_origins)
        if any(not origin for origin in origins):
            raise SettingsError("ASSISTANT_CORS_ORIGINS must not contain empty origins")
        if any(origin == "*" for origin in origins):
            raise SettingsError("ASSISTANT_CORS_ORIGINS must not contain a wildcard")
        object.__setattr__(self, "assistant_cors_origins", origins)

        for name in (
            "openai_api_key",
            "openai_base_url",
            "livekit_url",
            "livekit_api_key",
            "livekit_api_secret",
            "shot_assessor_model",
            "measurement_line_model",
            "vision_guidance_model",
            "background_model",
            "rembg_url",
            "background_generator_url",
        ):
            value = _text(getattr(self, name), field_name=name.upper())
            if name.endswith("_model") and not value:
                raise SettingsError(f"{name.upper()} must be a non-empty string")
            object.__setattr__(self, name, value)

        object.__setattr__(
            self,
            "livekit_token_ttl_seconds",
            _positive_int(
                self.livekit_token_ttl_seconds,
                field_name="LIVEKIT_TOKEN_TTL_SECONDS",
            ),
        )
        object.__setattr__(
            self,
            "livekit_token_max_ttl_seconds",
            _positive_int(
                self.livekit_token_max_ttl_seconds,
                field_name="LIVEKIT_TOKEN_MAX_TTL_SECONDS",
            ),
        )

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
        *,
        provider_mode: ProviderMode | str | None = None,
        api_host: str | None = None,
        api_port: int | str | None = None,
    ) -> "BackendSettings":
        """Resolve process environment once, with optional entrypoint overrides."""

        source = os.environ if env is None else env
        raw_origins = source.get(
            "ASSISTANT_CORS_ORIGINS",
            ",".join(DEFAULT_CORS_ORIGINS),
        )
        return cls(
            provider_mode=provider_mode if provider_mode is not None else source.get("PROVIDER_MODE", "fixture"),
            api_host=api_host if api_host is not None else source.get("API_HOST", "127.0.0.1"),
            api_port=api_port if api_port is not None else source.get("API_PORT", "3001"),
            assistant_cors_origins=_origins(raw_origins),
            openai_api_key=source.get("OPENAI_API_KEY", ""),
            openai_base_url=source.get("OPENAI_BASE_URL", ""),
            livekit_url=source.get("LIVEKIT_URL", ""),
            livekit_api_key=source.get("LIVEKIT_API_KEY", ""),
            livekit_api_secret=source.get("LIVEKIT_API_SECRET", ""),
            shot_assessor_model=source.get("SHOT_ASSESSOR_MODEL", DEFAULT_SHOT_ASSESSOR_MODEL),
            measurement_line_model=source.get("MEASUREMENT_LINE_MODEL", DEFAULT_MEASUREMENT_LINE_MODEL),
            vision_guidance_model=source.get("VISION_GUIDANCE_MODEL", DEFAULT_VISION_GUIDANCE_MODEL),
            background_model=source.get("BACKGROUND_MODEL", DEFAULT_BACKGROUND_MODEL),
            rembg_url=source.get("REMBG_URL", ""),
            background_generator_url=source.get("BACKGROUND_GENERATOR_URL", ""),
            livekit_token_ttl_seconds=_positive_int(
                source.get("LIVEKIT_TOKEN_TTL_SECONDS", "90"),
                field_name="LIVEKIT_TOKEN_TTL_SECONDS",
            ),
            livekit_token_max_ttl_seconds=_positive_int(
                source.get("LIVEKIT_TOKEN_MAX_TTL_SECONDS", "300"),
                field_name="LIVEKIT_TOKEN_MAX_TTL_SECONDS",
            ),
        )

    @property
    def livekit_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)

    def require_livekit(self) -> None:
        """Fail closed when an explicitly live Agent lacks its credentials."""

        missing = [
            name
            for name, value in (
                ("LIVEKIT_URL", self.livekit_url),
                ("LIVEKIT_API_KEY", self.livekit_api_key),
                ("LIVEKIT_API_SECRET", self.livekit_api_secret),
            )
            if not value
        ]
        if missing:
            raise SettingsError("LiveKit Agent settings are incomplete: " + ", ".join(missing))
        if not (self.livekit_url.startswith("wss://") or self.livekit_url.startswith("https://")):
            raise SettingsError("LIVEKIT_URL must use https or wss")


__all__ = [
    "BackendSettings",
    "DEFAULT_BACKGROUND_MODEL",
    "DEFAULT_CORS_ORIGINS",
    "DEFAULT_MEASUREMENT_LINE_MODEL",
    "DEFAULT_SHOT_ASSESSOR_MODEL",
    "DEFAULT_VISION_GUIDANCE_MODEL",
    "ProviderMode",
    "SettingsError",
]
