FROM python:3.11-slim

WORKDIR /workspace

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# pyproject.toml and uv.lock are the only Python dependency source.  Keep the
# uv version compatible with the repository lock format, then install only
# production dependencies into the image; Compose invokes the frozen venv.
RUN python -m pip install --no-cache-dir uv==0.12.7
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/__init__.py ./services/__init__.py
COPY services/listing_photo_assistant ./services/listing_photo_assistant

EXPOSE 3001

CMD ["python", "-m", "services.listing_photo_assistant.server"]
