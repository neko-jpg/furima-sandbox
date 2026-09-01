"""Compatibility adapter for Codex Proxy's SSE-backed Responses endpoint.

The official OpenAI Responses endpoint returns a response object for a
non-streaming request.  Codex Proxy accepts that request but emits the
underlying Codex stream instead, leaving the SDK's assembled ``output`` empty.
This small adapter deliberately requests the stream and reconstructs only the
text needed by the closed provider contracts.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Protocol


class AsyncResponsesResource(Protocol):
    async def create(self, **kwargs: object) -> object:
        """Create one Responses request or return its async event stream."""


@dataclass(frozen=True, slots=True)
class ProxyResponsesResult:
    """Minimal response shape consumed by the existing provider adapters."""

    output_text: str
    response: object | None = None


class ProxyResponsesError(RuntimeError):
    """Raised when Codex Proxy cannot produce a usable text stream."""


def _event_message(event: object) -> str:
    error = getattr(event, "error", None)
    message = getattr(error, "message", None)
    if isinstance(message, str) and message:
        return message
    if isinstance(error, dict):
        value = error.get("message")
        if isinstance(value, str) and value:
            return value
    return "Codex Proxy Responses request failed"


class ProxyResponsesClient:
    """Turn Codex Proxy SSE events into an SDK-like ``output_text`` result."""

    def __init__(self, client: AsyncResponsesResource) -> None:
        self._client = client

    async def create(self, **kwargs: object) -> ProxyResponsesResult:
        request = dict(kwargs)
        request["stream"] = True
        stream = await self._client.create(**request)
        deltas: list[str] = []
        completed_response: object | None = None
        try:
            async for event in stream:  # type: ignore[union-attr]
                event_type = getattr(event, "type", "")
                if event_type == "error":
                    raise ProxyResponsesError(_event_message(event))
                if event_type == "response.output_text.delta":
                    delta = getattr(event, "delta", None)
                    if isinstance(delta, str):
                        deltas.append(delta)
                elif event_type == "response.output_text.done" and not deltas:
                    text = getattr(event, "text", None)
                    if isinstance(text, str):
                        deltas.append(text)
                elif event_type == "response.completed":
                    completed_response = getattr(event, "response", None)
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                result = close()
                if inspect.isawaitable(result):
                    await result

        output_text = "".join(deltas)
        if not output_text and completed_response is not None:
            fallback = getattr(completed_response, "output_text", None)
            if isinstance(fallback, str):
                output_text = fallback
        if not output_text:
            raise ProxyResponsesError(
                "Codex Proxy Responses stream contained no output text"
            )
        return ProxyResponsesResult(output_text, completed_response)


__all__ = [
    "AsyncResponsesResource",
    "ProxyResponsesClient",
    "ProxyResponsesError",
    "ProxyResponsesResult",
]
