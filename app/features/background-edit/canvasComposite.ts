import { assertMaskDimensions, validateMaskPixels } from './maskValidation';
import type { MaskPixelData } from './maskValidation';

export type CompositeImageInput = Blob | CanvasImageSource;

export interface BackgroundCompositeOptions {
  readonly original: CompositeImageInput;
  readonly mask: CompositeImageInput;
  readonly background: CompositeImageInput;
  readonly outputType?: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly quality?: number;
}

interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly close?: () => void;
}

type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const isBlob = (value: CompositeImageInput): value is Blob => typeof Blob !== 'undefined' && value instanceof Blob;

const imageDimensions = (source: CanvasImageSource): { width: number; height: number } => {
  const value = source as unknown as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number };
  const width = value.width ?? value.naturalWidth ?? value.videoWidth ?? 0;
  const height = value.height ?? value.naturalHeight ?? value.videoHeight ?? 0;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('Image dimensions are unavailable.');
  return { width, height };
};

const decodeImage = async (input: CompositeImageInput): Promise<DecodedImage> => {
  if (!isBlob(input)) {
    const dimensions = imageDimensions(input);
    return { source: input, ...dimensions };
  }
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(input);
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

const toBlob = async (surface: CanvasSurface, type: BackgroundCompositeOptions['outputType'], quality: number | undefined): Promise<Blob> => {
  if (isOffscreenSurface(surface)) return surface.convertToBlob({ type: type ?? 'image/jpeg', quality });
  const canvas = surface as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob: Blob | null) => blob ? resolve(blob) : reject(new Error('Canvas encoding failed.')), type ?? 'image/jpeg', quality);
  });
};

const validateDecodedMask = (source: DecodedImage, expected: DecodedImage): void => {
  assertMaskDimensions(source, expected);
  const surface = createSurface(source.width, source.height);
  const context = context2d(surface);
  context.drawImage(source.source, 0, 0, source.width, source.height);
  const image = context.getImageData(0, 0, source.width, source.height);
  const data: MaskPixelData = { width: source.width, height: source.height, data: image.data };
  validateMaskPixels(data);
};

/**
 * Composes background + (original RGB × validated mask). The background
 * provider is never called here and receives no product image.
 */
export async function composeBackgroundPreview(options: BackgroundCompositeOptions): Promise<Blob> {
  if (options.quality !== undefined && (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) throw new RangeError('quality must be between 0 and 1.');
  const [original, mask, background] = await Promise.all([
    decodeImage(options.original),
    decodeImage(options.mask),
    decodeImage(options.background),
  ]);
  try {
    validateDecodedMask(mask, original);
    const foregroundSurface = createSurface(original.width, original.height);
    const foreground = context2d(foregroundSurface);
    foreground.drawImage(original.source, 0, 0, original.width, original.height);
    foreground.globalCompositeOperation = 'destination-in';
    foreground.drawImage(mask.source, 0, 0, original.width, original.height);

    const outputSurface = createSurface(original.width, original.height);
    const output = context2d(outputSurface);
    output.drawImage(background.source, 0, 0, original.width, original.height);
    output.drawImage(foregroundSurface, 0, 0, original.width, original.height);
    return await toBlob(outputSurface, options.outputType, options.quality ?? 0.92);
  } finally {
    original.close?.();
    mask.close?.();
    background.close?.();
  }
}
