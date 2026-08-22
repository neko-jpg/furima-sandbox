export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_OUTPUT_BYTES = 10 * 1024 * 1024;
export const IMAGE_TRANSFORM_TIMEOUT_MS = 5_000;

const ALLOWED_IMAGE_PATH_PREFIXES = ['/images/products/', '/images/branding/', '/images/marketing/'];
const ALLOWED_IMAGE_FILES = new Set(['/favicon.svg', '/file.svg', '/globe.svg', '/window.svg']);
const SAFE_SOURCE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heis', 'hevm', 'mif1', 'msf1']);

export const isAllowedImageSourcePath = (source: string): boolean => {
  if (!source.startsWith('/') || source.startsWith('//') || source.includes('\\') || source.includes('..') || source.includes('?') || source.includes('#')) return false;
  return ALLOWED_IMAGE_FILES.has(source) || ALLOWED_IMAGE_PATH_PREFIXES.some((prefix) => source.startsWith(prefix));
};

export const isSafeSourceImageType = (value: string | null): boolean => {
  const contentType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return SAFE_SOURCE_IMAGE_TYPES.has(contentType);
};

const startsWithBytes = (bytes: Uint8Array, signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);

export const hasBlockedImageSignature = (bytes: Uint8Array): boolean => {
  if (startsWithBytes(bytes, [0x69, 0x63, 0x6e, 0x73]) || startsWithBytes(bytes, [0xff, 0x0a])) return true;
  if (bytes.length < 12 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return HEIF_BRANDS.has(brand);
};

export const readLimitedBody = async (body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> => {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
};

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IMAGE_TRANSFORM_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
