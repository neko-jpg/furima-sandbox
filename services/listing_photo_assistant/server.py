"""FastAPI process entrypoint for local and Compose runs."""

from __future__ import annotations

import logging

import uvicorn

from .app import create_app
from .config import BackendSettings


def main() -> None:
    settings = BackendSettings.from_env()
    logging.basicConfig(level=logging.INFO)
    logging.getLogger(__name__).info(
        "assistant_api_starting provider_mode=%s url=http://%s:%s",
        settings.provider_mode,
        settings.api_host,
        settings.api_port,
    )
    uvicorn.run(
        create_app(settings),
        host=settings.api_host,
        port=settings.api_port,
        log_level="info",
    )


if __name__ == "__main__":  # pragma: no cover
    main()


__all__ = ["main"]
