import type { LiveKitTokenProvider, LiveKitTokenResponse } from './liveKitAdapter';

export interface LiveKitHttpTokenProviderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export class LiveKitTokenProviderError extends Error {
  public readonly retryable: boolean;

  public constructor(message: string, retryable = true) {
    super(message);
    this.name = 'LiveKitTokenProviderError';
    this.retryable = retryable;
  }
}

const trimBaseUrl = (value: string): string => value.trim().replace(/\/+$/u, '');

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as unknown;
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
  } catch {
    // Keep provider details out of the browser-facing error when the body is not JSON.
  }
  return 'LiveKit接続情報を取得できません。';
};
const parseTokenResponse = (value: unknown): LiveKitTokenResponse => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LiveKitTokenProviderError('LiveKit接続情報の形式が不正です。', false);
  }
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyString(record.token)
    || !isNonEmptyString(record.participantIdentity)
    || !isNonEmptyString(record.roomName)
    || typeof record.expiresAt !== 'number'
    || !Number.isFinite(record.expiresAt)
    || record.expiresAt <= 0
    || !isNonEmptyString(record.livekitUrl)
    || !/^(?:https|wss):\/\//u.test(record.livekitUrl)
  ) {
    throw new LiveKitTokenProviderError('LiveKit接続情報の形式が不正です。', false);
  }
  return {
    token: record.token,
    participantIdentity: record.participantIdentity,
    roomName: record.roomName,
    expiresAt: record.expiresAt,
    livekitUrl: record.livekitUrl,
  };
};

/** Fetches only a short-lived browser token; server credentials never cross this boundary. */
export class LiveKitHttpTokenProvider implements LiveKitTokenProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: LiveKitHttpTokenProviderOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl);
    if (!this.baseUrl) throw new TypeError('baseUrl must not be empty');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async getToken(sessionId: string): Promise<LiveKitTokenResponse> {
    if (!isNonEmptyString(sessionId) || sessionId.length > 96) {
      throw new LiveKitTokenProviderError('sessionIdが不正です。', false);
    }
    const response = await this.fetchImpl(`${this.baseUrl}/api/livekit-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new LiveKitTokenProviderError(await readErrorMessage(response), response.status >= 500);
    }
    return parseTokenResponse(await response.json());
  }
}

export const configuredLiveKitApiUrl = (): string | null => {
  const runtime = import.meta as ImportMeta & { env?: Record<string, unknown> };
  const value = runtime.env?.VITE_LISTING_ASSISTANT_API_URL;
  return typeof value === 'string' && value.trim() ? trimBaseUrl(value) : null;
};

export const createConfiguredLiveKitTokenProvider = (): LiveKitHttpTokenProvider | null => {
  const baseUrl = configuredLiveKitApiUrl();
  return baseUrl ? new LiveKitHttpTokenProvider({ baseUrl }) : null;
};
