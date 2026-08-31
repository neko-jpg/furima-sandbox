"""FastAPI application assembly for Furima's local Python service."""

from __future__ import annotations

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from .analyze_shot import analyze_shot_router, get_shot_assessor
from .config import BackendSettings
from .image_routes import (
    get_background_generator,
    get_garment_masker,
    get_measurement_line_provider,
    image_processing_router,
)
from .livekit_token import LiveKitConfig, get_livekit_config, livekit_token_router
from .providers.background import create_background_generator
from .providers.mask import create_garment_masker
from .providers.measurement import create_measurement_line_provider
from .providers.shot_assessor_factory import create_shot_assessor


def create_app(settings: BackendSettings | None = None) -> FastAPI:
    """Create an app with one immutable settings snapshot.

    The default global app resolves the process environment at import time,
    while tests, entrypoints, and embedded callers can pass an explicit
    snapshot.  Dependency overrides close over that snapshot, so no request
    rereads ``os.environ`` or can switch provider mode halfway through a run.
    """

    resolved_settings = settings or BackendSettings.from_env()
    token_config = LiveKitConfig(
        api_key=resolved_settings.livekit_api_key,
        api_secret=resolved_settings.livekit_api_secret,
        url=resolved_settings.livekit_url,
        token_ttl_seconds=resolved_settings.livekit_token_ttl_seconds,
        max_token_ttl_seconds=resolved_settings.livekit_token_max_ttl_seconds,
    )
    app = FastAPI(title="Furima listing photo assistant")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.assistant_cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["accept", "content-type"],
        allow_credentials=False,
    )
    app.state.settings = resolved_settings

    # Providers are constructed once per application instance.  Besides
    # avoiding a client allocation for every upload, this guarantees that all
    # routes share the same resolved mode and configuration snapshot.
    shot_assessor = create_shot_assessor(resolved_settings)
    measurement_line_provider = create_measurement_line_provider(resolved_settings)
    garment_masker = create_garment_masker(resolved_settings)
    background_generator = create_background_generator(resolved_settings)

    @app.get("/api/health")
    async def health(response: Response) -> dict[str, str]:
        response.headers["cache-control"] = "no-store"
        return {"status": "ok"}

    app.include_router(livekit_token_router)
    app.include_router(analyze_shot_router)
    app.include_router(image_processing_router)
    app.dependency_overrides[get_livekit_config] = lambda: token_config
    app.dependency_overrides[get_shot_assessor] = lambda: shot_assessor
    app.dependency_overrides[get_measurement_line_provider] = lambda: measurement_line_provider
    app.dependency_overrides[get_garment_masker] = lambda: garment_masker
    app.dependency_overrides[get_background_generator] = lambda: background_generator
    return app


app = create_app()

__all__ = ["BackendSettings", "app", "create_app"]
