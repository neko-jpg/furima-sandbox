"""Shared safe error contract for HTTP-facing providers."""

from __future__ import annotations

from enum import Enum


class ProviderErrorCode(str, Enum):
    TIMEOUT = "TIMEOUT"
    UNAVAILABLE = "UNAVAILABLE"
    INVALID_RESPONSE = "INVALID_RESPONSE"
    INVALID_INPUT = "INVALID_INPUT"
    UNKNOWN = "UNKNOWN"

    # Internal adapter codes are normalized to the public values by the HTTP
    # route, but retaining them here keeps diagnostics and provider tests safe.
    INVALID_MASK = "INVALID_MASK"
    PROVIDER_FAILURE = "PROVIDER_FAILURE"


class ProviderError(ValueError):
    """Finite provider failure that never exposes upstream internals."""

    def __init__(
        self,
        code: ProviderErrorCode | str,
        message: str,
        *,
        retryable: bool = True,
        provider: str = "provider",
    ) -> None:
        try:
            self.code = code if isinstance(code, ProviderErrorCode) else ProviderErrorCode(code)
        except (TypeError, ValueError):
            self.code = ProviderErrorCode.UNKNOWN
        if not isinstance(message, str) or not message.strip():
            raise ValueError("provider error message must be non-empty")
        if not isinstance(retryable, bool):
            raise ValueError("provider error retryable must be boolean")
        if not isinstance(provider, str) or not provider.strip():
            raise ValueError("provider error provider must be non-empty")
        self.message = message
        self.retryable = retryable
        self.provider = provider
        super().__init__(message)

    def to_payload(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "code": self.code.value,
            "message": self.message,
            "retryable": self.retryable,
        }


__all__ = ["ProviderError", "ProviderErrorCode"]
