export type BackgroundStyleId = 'studio_white' | 'warm_neutral' | 'light_wood';

export interface BackgroundEditProvider {
  removeBackground(original: Blob): Promise<Blob>;
  generateBackground(styleId: BackgroundStyleId): Promise<Blob>;
}
export class BackgroundEditProviderError extends Error {
  public readonly retryable: boolean;

  public constructor(message: string, retryable = true) {
    super(message);
    this.name = 'BackgroundEditProviderError';
    this.retryable = retryable;
  }
}

export interface HttpBackgroundEditProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  maskTimeoutMs?: number;
  backgroundTimeoutMs?: number;
}

const trimBaseUrl = (value: string): string => value.trim().replace(/\/+$/u, '');
const MASK_TIMEOUT_MS = 35_000;
const BACKGROUND_TIMEOUT_MS = 60_000;

const validateTimeout = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0 || value > 120_000) throw new RangeError(`${label} must be between 1ms and 120s.`);
  return value;
};

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = await response.json() as unknown;
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === 'object' && detail !== null && !Array.isArray(detail) && typeof (detail as { message?: unknown }).message === 'string') return (detail as { message: string }).message;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
  } catch {
    // The public fallback is deliberately provider-agnostic.
  }
  return fallback;
};

const validateStyleId = (styleId: string): BackgroundStyleId => {
  if (styleId !== 'studio_white' && styleId !== 'warm_neutral' && styleId !== 'light_wood') throw new BackgroundEditProviderError('背景スタイルが許可されていません。', false);
  return styleId;
};

export class HttpBackgroundEditProvider implements BackgroundEditProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maskTimeoutMs: number;
  private readonly backgroundTimeoutMs: number;

  public constructor(options: HttpBackgroundEditProviderOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl);
    if (!this.baseUrl) throw new TypeError('baseUrl must not be empty');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maskTimeoutMs = validateTimeout(options.maskTimeoutMs ?? MASK_TIMEOUT_MS, 'mask timeout');
    this.backgroundTimeoutMs = validateTimeout(options.backgroundTimeoutMs ?? BACKGROUND_TIMEOUT_MS, 'background timeout');
  }

  private async request(url: string, init: RequestInit, timeoutMs: number, timeoutMessage: string): Promise<Response> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
        reject(new BackgroundEditProviderError(timeoutMessage, true));
      }, timeoutMs);
    });
    try {
      const requestInit: RequestInit = controller ? { ...init, signal: controller.signal } : init;
      return await Promise.race([this.fetchImpl(url, requestInit), timeout]);
    } catch (error) {
      if (error instanceof BackgroundEditProviderError) throw error;
      if (timedOut || (typeof DOMException === 'function' && error instanceof DOMException && error.name === 'AbortError')) throw new BackgroundEditProviderError(timeoutMessage, true);
      throw new BackgroundEditProviderError('背景処理サービスに接続できません。', true);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  public async removeBackground(original: Blob): Promise<Blob> {
    const form = new FormData();
    form.append('file', original, 'front-original.jpg');
    const response = await this.request(`${this.baseUrl}/api/remove-background`, { method: 'POST', body: form, credentials: 'omit' }, this.maskTimeoutMs, '背景分離がタイムアウトしました。');
    if (!response.ok) throw new BackgroundEditProviderError(await readErrorMessage(response, '背景分離に失敗しました。'), response.status >= 500 || response.status === 408);
    try {
      return await response.blob();
    } catch {
      throw new BackgroundEditProviderError('背景分離の画像を読み込めませんでした。', true);
    }
  }

  public async generateBackground(styleId: BackgroundStyleId): Promise<Blob> {
    const response = await this.request(`${this.baseUrl}/api/generate-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ styleId: validateStyleId(styleId) }),
      credentials: 'omit',
    }, this.backgroundTimeoutMs, '背景生成がタイムアウトしました。');
    if (!response.ok) throw new BackgroundEditProviderError(await readErrorMessage(response, '背景生成に失敗しました。'), response.status >= 500 || response.status === 408);
    try {
      return await response.blob();
    } catch {
      throw new BackgroundEditProviderError('背景生成の画像を読み込めませんでした。', true);
    }
  }
}

const blobFromCanvas = (canvas: HTMLCanvasElement, type: string): Promise<Blob> => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new BackgroundEditProviderError('背景fixtureの画像生成に失敗しました。', true)), type, 0.92);
});

const imageSize = async (blob: Blob): Promise<{ width: number; height: number }> => {
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  if (typeof URL === 'undefined' || typeof Image === 'undefined') throw new BackgroundEditProviderError('このブラウザでは画像を読み込めません。', false);
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('decode failed'));
      element.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Local fallback used by standalone `npm run dev` without the Python API. */
export class FixtureBackgroundEditProvider implements BackgroundEditProvider {
  public async removeBackground(original: Blob): Promise<Blob> {
    if (typeof document === 'undefined') throw new BackgroundEditProviderError('Canvasが利用できません。', false);
    const { width, height } = await imageSize(original);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new BackgroundEditProviderError('Canvasが利用できません。', false);
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.beginPath();
    context.ellipse(width / 2, height / 2, Math.max(1, width * 0.34), Math.max(1, height * 0.4), 0, 0, Math.PI * 2);
    context.fill();
    return blobFromCanvas(canvas, 'image/png');
  }

  public async generateBackground(styleId: BackgroundStyleId): Promise<Blob> {
    if (typeof document === 'undefined') throw new BackgroundEditProviderError('Canvasが利用できません。', false);
    const colors: Record<BackgroundStyleId, string> = { studio_white: '#f8f8f8', warm_neutral: '#f1e8dc', light_wood: '#e0c69e' };
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    if (!context) throw new BackgroundEditProviderError('Canvasが利用できません。', false);
    context.fillStyle = colors[validateStyleId(styleId)];
    context.fillRect(0, 0, 2, 2);
    return blobFromCanvas(canvas, 'image/png');
  }
}

export function createConfiguredBackgroundEditProvider(): BackgroundEditProvider {
  const runtime = import.meta as ImportMeta & { env?: Record<string, unknown> };
  const baseUrl = runtime.env?.VITE_LISTING_ASSISTANT_API_URL;
  return typeof baseUrl === 'string' && baseUrl.trim() ? new HttpBackgroundEditProvider({ baseUrl }) : new FixtureBackgroundEditProvider();
}
