"""Explicit rembg prewarm boundary for the live listing-photo pipeline.

The live sidecar loads BiRefNet lazily on its first request.  This helper sends
one real front-image-shaped request through the same mask contract used by the
HTTP route, so an unavailable sidecar or an invalid output fails before a user
starts the capture flow.  It never stores the source image or returns source
RGB pixels.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from .config import BackendSettings
from .providers.mask import (
    GarmentMasker,
    MaskInput,
    MaskResult,
    RembgBackend,
    create_garment_masker,
)


class RembgPrewarmError(RuntimeError):
    """Raised when the live mask sidecar cannot pass its production contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def prewarm_rembg(
    front_data: bytes,
    mime_type: str,
    *,
    settings: BackendSettings | None = None,
    masker: GarmentMasker | None = None,
    backend: RembgBackend | Callable[[bytes], bytes | Awaitable[bytes]] | None = None,
) -> MaskResult:
    """Warm and verify rembg using the exact production ``GarmentMasker``.

    ``masker`` and ``backend`` are dependency-injection seams for tests.  In a
    live process, omitting both selects the configured rembg endpoint (or the
    local ``rembg`` runtime) and never silently switches to fixture output.
    """

    if masker is not None and backend is not None:
        raise ValueError("pass either masker or backend, not both")

    selected = masker
    if selected is None:
        selected = create_garment_masker(
            settings,
            mode="live",
            live_backend=backend,
        )

    result = await selected.mask(MaskInput(front_data, mime_type))
    if not result.success or result.mask_png is None:
        error = result.error
        raise RembgPrewarmError(
            error.code.value if error is not None and hasattr(error.code, "value") else str(error.code) if error is not None else "UNAVAILABLE",
            error.message if error is not None else "rembg prewarm failed",
        )
    return result


__all__ = ["RembgPrewarmError", "prewarm_rembg"]
