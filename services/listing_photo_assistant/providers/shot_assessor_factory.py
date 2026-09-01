"""Explicit fixture/live selection for post-capture shot assessment."""

from __future__ import annotations

from ..config import BackendSettings
from .shot_assessor import (
    NextAction,
    RequestedShot,
    ResponsesClient,
    ResponsesShotAssessor,
    ShotAssessment,
    ShotAssessor,
    ShotAssessorInput,
)
from .proxy_responses import ProxyResponsesClient


class LiveShotAssessorUnavailable(RuntimeError):
    """The explicitly selected live provider cannot be constructed."""


class FixtureShotAssessor:
    """Deterministic fixture result; it never calls an external provider."""

    async def assess(self, input: ShotAssessorInput) -> ShotAssessment:
        missing_by_requested_shot = {
            RequestedShot.FRONT: (RequestedShot.BACK, RequestedShot.TAG),
            RequestedShot.BACK: (RequestedShot.TAG,),
            RequestedShot.TAG: (),
        }
        missing = missing_by_requested_shot[input.requested_shot]
        return ShotAssessment(
            shot_type=input.requested_shot,
            quality="ok",
            issues=(),
            missing_shots=missing,
            next_action=NextAction.COMPLETE if not missing else NextAction.REQUEST_NEXT,
        )


class _UnavailableLiveShotAssessor:
    async def assess(self, input: ShotAssessorInput) -> ShotAssessment:
        del input
        raise LiveShotAssessorUnavailable(
            "live ShotAssessor is unavailable; explicitly restart with "
            "PROVIDER_MODE=fixture to use deterministic fixture responses"
        )


def _create_responses_client(settings: BackendSettings) -> ResponsesClient:
    if not settings.openai_api_key:
        raise LiveShotAssessorUnavailable(
            "OPENAI_API_KEY is required for PROVIDER_MODE=live"
        )
    try:
        from openai import AsyncOpenAI  # type: ignore[import-not-found]
    except ImportError as error:
        raise LiveShotAssessorUnavailable(
            "openai package is required for PROVIDER_MODE=live"
        ) from error
    kwargs: dict[str, object] = {
        "api_key": settings.openai_api_key,
        "max_retries": settings.openai_max_retries,
    }
    if settings.openai_base_url:
        kwargs["base_url"] = settings.openai_base_url
    responses = AsyncOpenAI(**kwargs).responses
    return (
        ProxyResponsesClient(responses)
        if settings.openai_base_url
        else responses
    )  # type: ignore[return-value]


def create_shot_assessor(
    settings: BackendSettings | None = None,
    *,
    live_assessor: ShotAssessor | None = None,
    live_client: ResponsesClient | None = None,
    live_model: str | None = None,
) -> ShotAssessor:
    """Construct only the provider explicitly selected by ``PROVIDER_MODE``."""

    resolved = settings or BackendSettings.from_env()
    if resolved.provider_mode == "fixture":
        return FixtureShotAssessor()
    if live_assessor is not None:
        return live_assessor
    try:
        client = live_client or _create_responses_client(resolved)
        model = live_model or resolved.shot_assessor_model
        return ResponsesShotAssessor(
            client,
            model,
            reasoning_effort=resolved.llm_reasoning_effort,
            max_output_tokens=resolved.llm_max_output_tokens,
        )
    except LiveShotAssessorUnavailable:
        return _UnavailableLiveShotAssessor()


def get_configured_shot_assessor(settings: BackendSettings | None = None) -> ShotAssessor:
    return create_shot_assessor(settings)


__all__ = [
    "FixtureShotAssessor",
    "LiveShotAssessorUnavailable",
    "create_shot_assessor",
    "get_configured_shot_assessor",
]
