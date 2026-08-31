import { assertMaskDimensions, validateMaskPixels } from './maskValidation.ts';
import type { MaskPixelData } from './maskValidation.ts';

export type CompositeImageInput = Blob | CanvasImageSource;
export type CompositeOutputType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface BackgroundCompositeOptions {
  readonly original: CompositeImageInput;
  readonly mask: CompositeImageInput;
  readonly background: CompositeImageInput;
  readonly outputType?: CompositeOutputType;
  readonly quality?: number;
}

/** RGBA pixels in intrinsic image coordinates. */
export interface RgbaPixelBuffer extends MaskPixelData {
  readonly data: ArrayLike<number>;
}

interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly close?: () => void;
}

type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const OUTPUT_TYPES: ReadonlySet<CompositeOutputType> = new Set(['image/jpeg', 'image/png', 'image/webp']);

const isBlob = (value: CompositeImageInput): value is Blob => typeof Blob !== 'undefined' && value instanceof Blob;

const positiveDimension = (...values: unknown[]): number => {
  const value = values.find((candidate) => Number.isInteger(candidate) && (candidate as number) > 0);
  return typeof value === 'number' ? value : 0;
};

const imageDimensions = (source: CanvasImageSource): { width: number; height: number } => {
  const value = source as unknown as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const width = positiveDimension(value.width, value.naturalWidth, value.videoWidth);
  const height = positiveDimension(value.height, value.naturalHeight, value.videoHeight);
  if (!width || !height) throw new Error('Image dimensions are unavailable.');
  return { width, height };
};

const decodeImage = async (input: CompositeImageInput): Promise<DecodedImage> => {
  if (!isBlob(input)) {
    const dimensions = imageDimensions(input);
    return { source: input, ...dimensions };
  }
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(input);
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new Error('Image dimensions are unavailable.');
    }
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  if (typeof URL === 'undefined' || typeof Image === 'undefined') throw new Error('This browser cannot decode image blobs.');
  const url = URL.createObjectURL(input);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image decoding failed.'));
      element.src = url;
    });
    const dimensions = imageDimensions(image);
    return { source: image, ...dimensions, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

const createSurface = (width: number, height: number): CanvasSurface => {
  if (typeof globalThis.OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Canvas is unavailable in this browser.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const context2d = (surface: CanvasSurface): CanvasContext => {
  const context = surface.getContext('2d');
  if (!context) throw new Error('2D canvas context is unavailable.');
  return context as CanvasContext;
};

const isOffscreenSurface = (surface: CanvasSurface): surface is OffscreenCanvas => (
  typeof globalThis.OffscreenCanvas === 'function' && surface instanceof globalThis.OffscreenCanvas
);

const toBlob = async (
  surface: CanvasSurface,
  type: CompositeOutputType,
  quality: number | undefined,
): Promise<Blob> => {
  if (isOffscreenSurface(surface)) return surface.convertToBlob({ type, quality });
  const canvas = surface as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob: Blob | null) => blob ? resolve(blob) : reject(new Error('Canvas encoding failed.')), type, quality);
  });
};

const assertRgbaPixels = (input: RgbaPixelBuffer, label: string): number => {
  if (!Number.isInteger(input.width) || input.width <= 0 || !Number.isInteger(input.height) || input.height <= 0) {
    throw new Error(`${label} dimensions are invalid.`);
  }
  const pixelCount = input.width * input.height;
  if (!Number.isSafeInteger(pixelCount) || !input.data || input.data.length !== pixelCount * 4) {
    throw new Error(`${label} pixel data does not match its dimensions.`);
  }
  for (let index = 0; index < input.data.length; index += 1) {
    const value = input.data[index];
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${label} contains an invalid pixel.`);
  }
  return pixelCount;
};

/**
 * Composes one output pixel buffer without asking an image model to redraw the
 * product. Binary mask pixels are copied byte-for-byte from the original;
 * fractional mask pixels are blended only at the edge.
 */
export function compositeRgbaPixels(
  original: RgbaPixelBuffer,
  mask: RgbaPixelBuffer,
  background: RgbaPixelBuffer,
): Uint8ClampedArray {
  const pixelCount = assertRgbaPixels(original, 'Original');
  assertRgbaPixels(mask, 'Mask');
  assertRgbaPixels(background, 'Background');
  assertMaskDimensions(mask, original);
  if (background.width !== original.width || background.height !== original.height) {
    throw new Error('Background dimensions must match the output image.');
  }
  validateMaskPixels(mask);

  const output = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const maskRed = mask.data[offset];
    const maskAlpha = mask.data[offset + 3];
    const foregroundWeight = (maskRed / 255) * (maskAlpha / 255);
    if (foregroundWeight <= 0) {
      output.set([
        background.data[offset],
        background.data[offset + 1],
        background.data[offset + 2],
        background.data[offset + 3],
      ], offset);
      continue;
    }
    if (foregroundWeight >= 1) {
      output.set([
        original.data[offset],
        original.data[offset + 1],
        original.data[offset + 2],
        original.data[offset + 3],
      ], offset);
      continue;
    }
    for (let channel = 0; channel < 4; channel += 1) {
      output[offset + channel] = Math.round(
        original.data[offset + channel] * foregroundWeight
        + background.data[offset + channel] * (1 - foregroundWeight),
      );
    }
  }
  return output;
}

const readPixels = (source: DecodedImage, width: number, height: number): RgbaPixelBuffer => {
  const surface = createSurface(width, height);
  const context = context2d(surface);
  context.drawImage(source.source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { width, height, data: image.data };
};

const normalizeOutputType = (value: CompositeOutputType | undefined): CompositeOutputType => {
  const type = value ?? 'image/png';
  if (!OUTPUT_TYPES.has(type)) throw new RangeError('outputType must be PNG, JPEG, or WebP.');
  return type;
};

/** Re-encodes one approved image without changing its intrinsic dimensions. */
export async function encodeImageForOutput(
  input: CompositeImageInput,
  outputType: CompositeOutputType = 'image/png',
): Promise<Blob> {
  const type = normalizeOutputType(outputType);
  const decoded = await decodeImage(input);
  try {
    const surface = createSurface(decoded.width, decoded.height);
    const context = context2d(surface);
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
    return await toBlob(surface, type, type === 'image/png' ? undefined : 0.92);
  } finally {
    decoded.close?.();
  }
}

/**
 * Composes background + (original RGB × validated mask). The background
 * provider is never called here and receives no product image.
 */
export async function composeBackgroundPreview(options: BackgroundCompositeOptions): Promise<Blob> {
  if (options.quality !== undefined && (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) {
    throw new RangeError('quality must be between 0 and 1.');
  }
  const outputType = normalizeOutputType(options.outputType);
  const decoded: Array<DecodedImage | null> = [null, null, null];
  try {
    decoded[0] = await decodeImage(options.original);
    decoded[1] = await decodeImage(options.mask);
    decoded[2] = await decodeImage(options.background);
    const original = decoded[0];
    const mask = decoded[1];
    const background = decoded[2];
    if (!original || !mask || !background) throw new Error('Image decoding failed.');
    assertMaskDimensions(mask, original);
    const originalPixels = readPixels(original, original.width, original.height);
    const maskPixels = readPixels(mask, mask.width, mask.height);
    const backgroundPixels = readPixels(background, original.width, original.height);
    const outputPixels = compositeRgbaPixels(originalPixels, maskPixels, backgroundPixels);

    const outputSurface = createSurface(original.width, original.height);
    const output = context2d(outputSurface);
    const image = output.createImageData(original.width, original.height);
    image.data.set(outputPixels);
    output.putImageData(image, 0, 0);
    return await toBlob(outputSurface, outputType, outputType === 'image/png' ? undefined : options.quality ?? 0.92);
  } finally {
    decoded.forEach((image) => image?.close?.());
  }
}
