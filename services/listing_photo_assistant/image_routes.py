"""HTTP boundaries for measurement, mask, and background providers."""

from __future__ import annotations

import asyncio
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from .providers.background import (
    BackgroundGenerator,
    BackgroundResult,
    BackgroundProviderError,
    BACKGROUND_STYLE_IDS,
)
from .providers.image_utils import (
    ImagePayloadError,
    MAX_IMAGE_BYTES,
    image_dimensions,
    validate_image_payload,
)
from .providers.mask import (
    GarmentMasker,
    MaskInput,
    ProviderError as MaskProviderError,
    validate_mask_png,
)
from .providers.measurement import (
    MeasurementFailure,
    MeasurementImage,
    MeasurementLineContractError,
    MeasurementLineInput,
    MeasurementLineProvider,
    MeasurementProviderError,
    validate_measurement_points,
)


PROCESSING_TIMEOUT_SECONDS = 35.0
MEASUREMENT_TIMEOUT_SECONDS = 20.0
ALLOWED_STYLE_IDS = frozenset(BACKGROUND_STYLE_IDS)


def _provider_error(
    provider: str, code: str, message: str, *, retryable: bool
) -> dict[str, object]:
    return {"provider": provider, "code": code, "message": message, "retryable": retryable}


def _http_provider_error(provider: str, error: Exception) -> HTTPException:
    raw_code = getattr(error, "code", "UNAVAILABLE")
    code = raw_code.value if hasattr(raw_code, "value") else str(raw_code)
    code = {
        "INVALID_MASK": "INVALID_RESPONSE",
        "PROVIDER_FAILURE": "UNKNOWN",
    }.get(code, code if code in {"TIMEOUT", "UNAVAILABLE", "INVALID_RESPONSE", "INVALID_INPUT", "UNKNOWN"} else "UNKNOWN")
    message = getattr(error, "message", "Provider is unavailable")
    retryable = bool(getattr(error, "retryable", True))
    status_code = {
        "INVALID_INPUT": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "INVALID_RESPONSE": status.HTTP_502_BAD_GATEWAY,
        "TIMEOUT": status.HTTP_504_GATEWAY_TIMEOUT,
        "UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
    }.get(code, status.HTTP_503_SERVICE_UNAVAILABLE)
    return HTTPException(status_code=status_code, detail=_provider_error(provider, code, message, retryable=retryable))


async def _read_image(file: UploadFile, *, provider: str) -> tuple[bytes, str]:
    try:
        content_type = file.content_type or ""
        image = await file.read(MAX_IMAGE_BYTES + 1)
        return validate_image_payload(image, content_type), content_type
    except ImagePayloadError as error:
        error_message = str(error)
        error_status = (
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
            if "Unsupported image MIME type" in error_message
            else status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if "size limit" in error_message
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(
            status_code=error_status,
            detail=_provider_error(provider, "INVALID_INPUT", str(error), retryable=False),
        ) from error


def get_measurement_line_provider() -> MeasurementLineProvider:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=_provider_error(
            "measurement-line",
            "UNAVAILABLE",
            "Measurement line provider is not configured",
            retryable=True,
        ),
    )


def get_garment_masker() -> GarmentMasker:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=_provider_error(
            "garment-masker",
            "UNAVAILABLE",
            "Garment masker is not configured",
            retryable=True,
        ),
    )


def get_background_generator() -> BackgroundGenerator:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=_provider_error(
            "background-generator",
            "UNAVAILABLE",
            "Background generator is not configured",
            retryable=True,
        ),
    )


image_processing_router = APIRouter()


@image_processing_router.post("/api/suggest-measurement-points")
async def suggest_measurement_points(
    file: Annotated[UploadFile, File()],
    provider: Annotated[MeasurementLineProvider, Depends(get_measurement_line_provider)],
) -> dict[str, object]:
    image, content_type = await _read_image(file, provider="measurement-line")
    try:
        raw = await asyncio.wait_for(
            provider.suggest(MeasurementLineInput(MeasurementImage(image, content_type))),
            timeout=MEASUREMENT_TIMEOUT_SECONDS,
        )
        if isinstance(raw, MeasurementFailure):
            raise _http_provider_error("measurement-line", raw.error)
        return validate_measurement_points(raw).to_payload()
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=_provider_error("measurement-line", "TIMEOUT", "Measurement suggestion timed out", retryable=True),
        ) from None
    except MeasurementProviderError as error:
        raise _http_provider_error("measurement-line", error) from error
    except MeasurementLineContractError as error:
        raise _http_provider_error(
            "measurement-line",
            MeasurementProviderError("INVALID_RESPONSE", str(error), retryable=True),
        ) from error
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_provider_error("measurement-line", "UNAVAILABLE", "Measurement suggestion is unavailable", retryable=True),
        ) from None


@image_processing_router.post("/api/remove-background")
async def remove_background(
    file: Annotated[UploadFile, File()],
    masker: Annotated[GarmentMasker, Depends(get_garment_masker)],
) -> Response:
    image, content_type = await _read_image(file, provider="garment-masker")
    try:
        result = await asyncio.wait_for(masker.mask(MaskInput(image, content_type)), timeout=PROCESSING_TIMEOUT_SECONDS)
        if not result.success or not result.mask_png:
            error = result.error or MaskProviderError("UNAVAILABLE", "Background removal is unavailable", retryable=True)
            raise _http_provider_error("garment-masker", error)
        expected_size = image_dimensions(image)
        validate_mask_png(result.mask_png, expected_size=expected_size)
        if (result.width, result.height) != expected_size:
            raise MaskProviderError(
                "INVALID_MASK",
                "Mask metadata does not match the source image",
                retryable=True,
            )
        return Response(
            content=result.mask_png,
            media_type="image/png",
            headers={
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
            },
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=_provider_error("garment-masker", "TIMEOUT", "Background removal timed out", retryable=True),
        ) from None
    except MaskProviderError as error:
        raise _http_provider_error("garment-masker", error) from error
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_provider_error("garment-masker", "UNAVAILABLE", "Background removal is unavailable", retryable=True),
        ) from None


class BackgroundGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    styleId: Literal["studio_white", "warm_neutral", "light_wood"]

    @property
    def style_id(self) -> Literal["studio_white", "warm_neutral", "light_wood"]:
        return self.styleId


@image_processing_router.post("/api/generate-background")
async def generate_background(
    request: BackgroundGenerationRequest,
    generator: Annotated[BackgroundGenerator, Depends(get_background_generator)],
) -> Response:
    try:
        result = await asyncio.wait_for(generator.generate(request.style_id), timeout=60.0)
        if isinstance(result, BackgroundResult):
            if not result.success or not result.background_png:
                error = result.error or BackgroundProviderError("UNAVAILABLE", "Background generation is unavailable", retryable=True)
                raise _http_provider_error("background-generator", error)
            background = result.background_png
        elif isinstance(result, bytes):
            background = result
        else:
            raise BackgroundProviderError(
                "INVALID_RESPONSE",
                "Background provider returned invalid output",
                retryable=True,
            )
        # A custom injected provider may return raw bytes, so enforce the same
        # PNG contract at the HTTP boundary rather than trusting the adapter.
        from .providers.background import validate_background_png

        validate_background_png(background)
        return Response(
            content=background,
            media_type="image/png",
            headers={"cache-control": "no-store"},
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=_provider_error("background-generator", "TIMEOUT", "Background generation timed out", retryable=True),
        ) from None
    except BackgroundProviderError as error:
        raise _http_provider_error("background-generator", error) from error
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_provider_error("background-generator", "UNAVAILABLE", "Background generation is unavailable", retryable=True),
        ) from None


__all__ = [
    "BackgroundGenerationRequest",
    "image_processing_router",
    "get_background_generator",
    "get_garment_masker",
    "get_measurement_line_provider",
]
