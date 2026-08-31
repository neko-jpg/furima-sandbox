/**
 * Conversion between a normalized guide rectangle and intrinsic video pixels.
 * This is intentionally independent of a DOM element so a worker and fixture
 * tests can use the same math as the camera UI.
 */

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelRoi {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelRoiInput {
  readonly guide: NormalizedRect;
  readonly display: { readonly width: number; readonly height: number };
  readonly video: { readonly width: number; readonly height: number };
  readonly objectFit: "cover" | "contain";
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validate(input: PixelRoiInput): void {
  assertPositiveInteger(input.video.width, "video.width");
  assertPositiveInteger(input.video.height, "video.height");
  if (!Number.isFinite(input.display.width) || input.display.width <= 0) {
    throw new RangeError("display.width must be greater than zero");
  }
  if (!Number.isFinite(input.display.height) || input.display.height <= 0) {
    throw new RangeError("display.height must be greater than zero");
  }
  assertFinite(input.guide.x, "guide.x");
  assertFinite(input.guide.y, "guide.y");
  assertFinite(input.guide.width, "guide.width");
  assertFinite(input.guide.height, "guide.height");
  if (input.guide.width <= 0 || input.guide.height <= 0) {
    throw new RangeError("guide dimensions must be greater than zero");
  }
  if (input.objectFit !== "cover" && input.objectFit !== "contain") {
    throw new TypeError("objectFit must be cover or contain");
  }
}

function intersection(a: NormalizedRect, b: NormalizedRect): NormalizedRect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right <= left || bottom <= top
    ? null
    : { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Converts a centered `object-fit` guide.  Offscreen guides return their
 * visible intersection; a guide with no visible intersection returns null.
 */
export function toPixelRoi(input: PixelRoiInput): PixelRoi | null {
  validate(input);

  const guideLeft = clamp(input.guide.x, 0, 1);
  const guideTop = clamp(input.guide.y, 0, 1);
  const guideRight = clamp(input.guide.x + input.guide.width, 0, 1);
  const guideBottom = clamp(input.guide.y + input.guide.height, 0, 1);
  if (guideRight <= guideLeft || guideBottom <= guideTop) {
    return null;
  }

  const displayGuide: NormalizedRect = {
    x: guideLeft * input.display.width,
    y: guideTop * input.display.height,
    width: (guideRight - guideLeft) * input.display.width,
    height: (guideBottom - guideTop) * input.display.height,
  };
  const scale = input.objectFit === "cover"
    ? Math.max(input.display.width / input.video.width, input.display.height / input.video.height)
    : Math.min(input.display.width / input.video.width, input.display.height / input.video.height);
  const rendered: NormalizedRect = {
    x: (input.display.width - input.video.width * scale) / 2,
    y: (input.display.height - input.video.height * scale) / 2,
    width: input.video.width * scale,
    height: input.video.height * scale,
  };
  const visible = intersection(displayGuide, rendered);
  if (visible === null) {
    return null;
  }

  const x = clamp((visible.x - rendered.x) / scale, 0, input.video.width);
  const y = clamp((visible.y - rendered.y) / scale, 0, input.video.height);
  const right = clamp((visible.x + visible.width - rendered.x) / scale, 0, input.video.width);
  const bottom = clamp((visible.y + visible.height - rendered.y) / scale, 0, input.video.height);
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1) {
    return null;
  }
  return { x, y, width, height };
}

export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    throw new TypeError("normalized rectangle values must be finite");
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const left = clamp(rect.x, 0, 1);
  const top = clamp(rect.y, 0, 1);
  const right = clamp(rect.x + rect.width, 0, 1);
  const bottom = clamp(rect.y + rect.height, 0, 1);
  return right <= left || bottom <= top
    ? null
    : { x: left, y: top, width: right - left, height: bottom - top };
}

