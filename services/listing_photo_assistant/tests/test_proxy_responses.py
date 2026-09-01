from __future__ import annotations

from dataclasses import dataclass

import pytest

from services.listing_photo_assistant.providers.proxy_responses import (
    ProxyResponsesClient,
    ProxyResponsesError,
)


@dataclass
class Event:
    type: str
    delta: str | None = None
    text: str | None = None
    error: object | None = None


class FakeStream:
    def __init__(self, events: list[Event]) -> None:
        self.events = events
        self.closed = False

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for event in self.events:
            yield event

    async def close(self) -> None:
        self.closed = True


class FakeResponsesResource:
    def __init__(self, stream: FakeStream) -> None:
        self.stream = stream
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> FakeStream:
        self.calls.append(kwargs)
        return self.stream


@pytest.mark.asyncio
async def test_proxy_responses_reassembles_text_deltas_and_closes_stream() -> None:
    stream = FakeStream(
        [
            Event("response.output_text.delta", delta='{"ok":'),
            Event("response.output_text.delta", delta="true}"),
            Event("response.completed"),
        ]
    )
    resource = FakeResponsesResource(stream)

    result = await ProxyResponsesClient(resource).create(
        model="gpt-5.6-luna",
        input=[],
    )

    assert result.output_text == '{"ok":true}'
    assert resource.calls == [
        {"model": "gpt-5.6-luna", "input": [], "stream": True}
    ]
    assert stream.closed is True


@pytest.mark.asyncio
async def test_proxy_responses_uses_done_text_when_no_deltas_are_emitted() -> None:
    resource = FakeResponsesResource(
        FakeStream(
            [
                Event(
                    "response.output_text.done",
                    text='{"ok":true}',
                ),
                Event("response.completed"),
            ]
        )
    )

    result = await ProxyResponsesClient(resource).create(model="gpt-5.6-luna")

    assert result.output_text == '{"ok":true}'


@pytest.mark.asyncio
async def test_proxy_responses_surfaces_stream_errors_and_closes_stream() -> None:
    stream = FakeStream(
        [Event("error", error={"message": "upstream unavailable"})]
    )

    with pytest.raises(ProxyResponsesError, match="upstream unavailable"):
        await ProxyResponsesClient(FakeResponsesResource(stream)).create(
            model="gpt-5.6-luna"
        )

    assert stream.closed is True
