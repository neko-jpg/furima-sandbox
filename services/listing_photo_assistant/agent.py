"""Configured entrypoint for the Python LiveKit camera Agent.

The transport implementation remains in :mod:`live_agent`. This module adds
explicit fixture/live provider selection while accepting both the current
Furima ``config.BackendSettings`` and the richer settings/provider runtime
that the parent integration may add later.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import sys
from collections.abc import Awaitable, Callable, Iterator, Sequence
from contextlib import contextmanager
from typing import Any

from . import live_agent as _live_agent
from .config import BackendSettings
from .guidance_transport import GuidanceTransportAdapter
from .live_agent import *  # noqa: F401,F403
from .providers.vision_guidance import (
    FixtureVisionGuidanceProvider,
    LiveVisionAnalyzer,
    LiveVisionGuidanceProvider,
    VisionGuidanceProvider,
)


LOGGER = logging.getLogger(__name__)

AgentRunner = Callable[[Any], Any]
ServerFactory = Callable[..., Any]
LiveAnalyzer = LiveVisionAnalyzer
ProviderInference = Callable[[object], Awaitable[Any]]
TransportFactory = Callable[
    [Any, Callable[[], _live_agent.Shot]], GuidanceTransportAdapter
]


def _provider_mode(settings: BackendSettings) -> str:
    raw_mode = getattr(settings, "provider_mode", "fixture")
    mode = getattr(raw_mode, "value", raw_mode)
    if not isinstance(mode, str):
        raise ValueError("provider_mode must be fixture or live")
    return mode.strip().lower()


def _optional_runtime_module() -> Any | None:
    """Load the parent provider runtime without making it an import requirement."""

    module_name = f"{__package__}.providers.runtime"
    try:
        return importlib.import_module(".providers.runtime", __package__)
    except ModuleNotFoundError as error:
        # A missing runtime module is the compatibility case for the current
        # service. A missing dependency inside an existing runtime is an
        # actionable error and must not be hidden by fixture fallback.
        if error.name == module_name:
            return None
        raise


def build_runtime_provider(
    settings: BackendSettings,
    *,
    live_analyzer: LiveVisionAnalyzer | None = None,
    live_provider: VisionGuidanceProvider | None = None,
) -> VisionGuidanceProvider:
    """Build exactly the provider selected by ``settings.provider_mode``.

    ``live_provider`` is the parent integration's concrete provider injection
    point. ``live_analyzer`` is a smaller callable boundary for tests and
    direct OpenAI adapters. Neither is accepted in fixture mode, and a live
    mode without either remains a live failure rather than a fixture result.
    """

    mode = _provider_mode(settings)
    if mode == "fixture":
        if live_analyzer is not None or live_provider is not None:
            raise ValueError("live provider injection is not allowed in fixture mode")
        return FixtureVisionGuidanceProvider()
    if mode != "live":
        raise ValueError("provider_mode must be fixture or live")
    if live_analyzer is not None and live_provider is not None:
        raise TypeError("provide live_analyzer or live_provider, not both")
    if live_provider is not None:
        return LiveVisionGuidanceProvider(provider=live_provider)

    runtime = _optional_runtime_module()
    factory = getattr(runtime, "create_vision_guidance_provider", None)
    if callable(factory):
        # Do not catch construction errors here. In particular, an absent
        # OpenAI key or malformed live configuration must remain visible.
        return factory(settings, live_analyzer=live_analyzer)
    return LiveVisionGuidanceProvider(analyzer=live_analyzer)


def create_provider_inference(
    settings: BackendSettings,
    provider: VisionGuidanceProvider,
    *,
    requested_shot: str = "front",
) -> _live_agent.Inference[Any, Any]:
    """Adapt a provider to the frame callback expected by ``live_agent``."""

    runtime = _optional_runtime_module()
    factory = getattr(runtime, "create_provider_inference", None)
    if callable(factory):
        # The parent runtime owns any richer frame adaptation it needs. This
        # call is still explicit: failures are propagated instead of falling
        # back to fixture inference.
        return factory(provider, requested_shot=requested_shot)
    if _provider_mode(settings) == "fixture":
        # The fixture provider is selected by the mode, not injected as a
        # live provider. This keeps the explicit fixture boundary compatible
        # with both the current and richer parent settings objects.
        return _live_agent.create_default_guidance_inference(
            settings,
            requested_shot=requested_shot,
        )
    return _live_agent.create_default_guidance_inference(
        settings,
        requested_shot=requested_shot,
        provider=provider,
    )


def _guidance_session_id(room: Any) -> str:
    """Resolve the room's validated session boundary without exposing secrets."""

    room_name = getattr(room, "name", None)
    if isinstance(room_name, str) and room_name.strip():
        try:
            return _live_agent.session_id_from_room_name(room_name)
        except ValueError:
            # A lightweight room fake may use a plain name.  It remains a
            # bounded opaque identifier; token-issued rooms use the strict
            # listing-photo-session-* form above.
            return room_name.strip()
    identity = getattr(getattr(room, "local_participant", None), "identity", None)
    if isinstance(identity, str) and identity.strip():
        return identity.strip()
    raise RuntimeError("LiveKit room has no session identifier")


def build_transport_factory(
    provider: VisionGuidanceProvider,
    settings: BackendSettings | None = None,
) -> TransportFactory:
    """Bind provider inference to a Room without leaking LiveKit into it."""

    resolved_settings = settings or BackendSettings(provider_mode="fixture")

    def factory(
        room: Any,
        current_shot: Callable[[], _live_agent.Shot],
    ) -> GuidanceTransportAdapter:
        return GuidanceTransportAdapter(
            create_provider_inference(
                resolved_settings,
                provider,
                requested_shot=current_shot,  # type: ignore[arg-type]
            ),
            _live_agent.RoomDataPublisher(room),
            session_id=_guidance_session_id(room),
        )

    return factory


def _build_server(
    server_factory: ServerFactory,
    inference: Any,
    transport_factory: TransportFactory | None = None,
    settings: BackendSettings | None = None,
) -> Any:
    kwargs: dict[str, Any] = {
        "inference": inference,
        "transport_factory": transport_factory,
    }
    if settings is not None:
        try:
            parameters = inspect.signature(server_factory).parameters
            accepts_settings = "settings" in parameters or any(
                parameter.kind is inspect.Parameter.VAR_KEYWORD
                for parameter in parameters.values()
            )
        except (TypeError, ValueError):
            # C-extension callables may not expose a signature. Passing the
            # immutable settings snapshot is safer for the real server path.
            accepts_settings = True
        if accepts_settings:
            kwargs["settings"] = settings
    server = server_factory(**kwargs)
    if server is None:
        raise RuntimeError(
            "unable to create the LiveKit Agent server; install the locked dependencies"
        )
    return server


def check_agent(
    settings: BackendSettings,
    *,
    live_analyzer: LiveVisionAnalyzer | None = None,
    live_provider: VisionGuidanceProvider | None = None,
    server_factory: ServerFactory = _live_agent.create_agent_server,
) -> VisionGuidanceProvider:
    """Perform an offline construction check without joining a Room."""

    provider = build_runtime_provider(
        settings,
        live_analyzer=live_analyzer,
        live_provider=live_provider,
    )
    inference = create_provider_inference(settings, provider)
    _build_server(
        server_factory,
        inference,
        build_transport_factory(provider, settings),
        settings,
    )
    LOGGER.info(
        "agent_check_ok provider_mode=%s provider=%s livekit_configured=%s",
        _provider_mode(settings),
        type(provider).__name__,
        settings.livekit_configured,
    )
    return provider


def _require_livekit(settings: BackendSettings) -> None:
    """Use richer settings validation when the parent integration provides it."""

    require = getattr(settings, "require_livekit", None)
    if callable(require):
        require()


def run_agent_worker(
    settings: BackendSettings,
    *,
    runner: AgentRunner,
    live_analyzer: LiveVisionAnalyzer | None = None,
    live_provider: VisionGuidanceProvider | None = None,
    server_factory: ServerFactory = _live_agent.create_agent_server,
) -> None:
    """Start an Agent worker with explicit configuration and injected I/O."""

    _require_livekit(settings)
    provider = build_runtime_provider(
        settings,
        live_analyzer=live_analyzer,
        live_provider=live_provider,
    )
    inference = create_provider_inference(settings, provider)
    server = _build_server(
        server_factory,
        inference,
        build_transport_factory(provider, settings),
        settings,
    )
    LOGGER.info(
        "agent_worker_starting provider_mode=%s provider=%s livekit_configured=%s",
        _provider_mode(settings),
        type(provider).__name__,
        settings.livekit_configured,
    )
    runner(server)


@contextmanager
def _worker_argv(arguments: Sequence[str] | None) -> Iterator[None]:
    if arguments is None:
        yield
        return
    previous = sys.argv
    sys.argv = [previous[0], *arguments]
    try:
        yield
    finally:
        sys.argv = previous


def main(
    settings: BackendSettings | None = None,
    *,
    runner: AgentRunner | None = None,
    live_analyzer: LiveVisionAnalyzer | None = None,
    live_provider: VisionGuidanceProvider | None = None,
    server_factory: ServerFactory = _live_agent.create_agent_server,
    worker_args: Sequence[str] | None = None,
) -> None:
    """Run the worker through the LiveKit Agents CLI.

    ``runner`` and ``server_factory`` are injectable so startup behavior can
    be verified without credentials, sockets, or a LiveKit service.
    """

    resolved_settings = settings or BackendSettings.from_env()
    selected_runner = runner
    if selected_runner is None:
        try:
            from livekit.agents import cli  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError(
                "livekit-agents is required to run the Agent; "
                "install the locked Python dependencies"
            ) from error
        selected_runner = cli.run_app

    with _worker_argv(worker_args):
        run_agent_worker(
            resolved_settings,
            runner=selected_runner,
            live_analyzer=live_analyzer,
            live_provider=live_provider,
            server_factory=server_factory,
        )


__all__ = [
    *[name for name in _live_agent.__all__ if name != "main"],
    "build_runtime_provider",
    "build_transport_factory",
    "check_agent",
    "create_provider_inference",
    "LiveAnalyzer",
    "main",
    "ProviderInference",
    "run_agent_worker",
]


if __name__ == "__main__":  # pragma: no cover - process entrypoint
    logging.basicConfig(level=logging.INFO)
    main()
