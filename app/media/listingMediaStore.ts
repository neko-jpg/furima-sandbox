import type { ListingMediaRef } from '../types/mercari';

const DB_NAME = 'furima-listing-media-v1';
const STORE_NAME = 'media';
const DRAFT_STORAGE_KEY = 'furima-listing-drafts-v3';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

interface StoredListingMedia {
  id: string;
  blob?: Blob;
  /** Compatibility read for v1 records written before the Blob migration. */
  dataUrl?: string;
  updatedAt: string;
}

const memoryMedia = new Map<string, StoredListingMedia>();
const previewUrls = new Map<string, string>();
let databasePromise: Promise<IDBDatabase | null> | null = null;
let fallbackMediaSequence = 0;
let previewCleanupInstalled = false;
const MEDIA_GC_DEFAULT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const hasIndexedDb = (): boolean => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const installPreviewCleanup = (): void => {
  if (previewCleanupInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  previewCleanupInstalled = true;
  const revokeAll = () => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.clear();
  };
  window.addEventListener('pagehide', revokeAll, { once: true });
};

const resetDatabaseConnection = (): void => {
  const pending = databasePromise;
  databasePromise = null;
  if (pending) void pending.then((database) => database?.close()).catch(() => undefined);
};

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  });
  void databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
};

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    let result: T | null = null;
    let settled = false;
    const transaction = database.transaction(STORE_NAME, mode);
    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
    transaction.onerror = () => { if (!settled) { settled = true; reject(transaction.error ?? new Error('indexeddb-transaction-failed')); } };
    transaction.onabort = () => { if (!settled) { settled = true; reject(transaction.error ?? new Error('indexeddb-transaction-aborted')); } };
    try {
      const request = run(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result ?? null; };
      request.onerror = () => { if (!settled) { settled = true; reject(request.error ?? new Error('indexeddb-request-failed')); } };
    } catch (error) {
      settled = true;
      reject(error);
    }
  });
};

const referencedDraftMediaIds = (): Set<string> => {
  const referenced = new Set<string>();
  if (typeof window === 'undefined' || !window.localStorage) return referenced;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || (key !== DRAFT_STORAGE_KEY && !key.startsWith(`${DRAFT_STORAGE_KEY}:`))) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const drafts = JSON.parse(raw) as unknown;
      if (!Array.isArray(drafts)) continue;
      for (const draft of drafts) {
        if (!draft || typeof draft !== 'object' || !Array.isArray((draft as { media?: unknown }).media)) continue;
        for (const candidate of (draft as { media: unknown[] }).media) {
          if (!candidate || typeof candidate !== 'object') continue;
          const id = (candidate as { id?: unknown }).id;
          if (typeof id === 'string' && id.startsWith('media_')) referenced.add(id);
        }
      }
    }
  } catch {
    // Storage can be unavailable in privacy modes. The caller-provided keep
    // set remains authoritative in that case, and the age threshold still
    // prevents aggressive deletion of recent media.
  }
  return referenced;
};

export const createListingMediaId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `media_${globalThis.crypto.randomUUID()}`;
  return `media_${Date.now().toString(36)}_${++fallbackMediaSequence}`;
};

export const putListingMedia = async (id: string, blob: Blob): Promise<void> => {
  const record: StoredListingMedia = { id, blob, updatedAt: new Date().toISOString() };
  memoryMedia.set(id, record);
  try {
    await withStore('readwrite', (store) => store.put(record));
  } catch {
    // The in-memory copy is a deliberate fallback. Do not turn a successful
    // local upload into a UI error merely because persistence is unavailable.
    resetDatabaseConnection();
  }
};

export const getListingMedia = async (id: string): Promise<string | null> => {
  installPreviewCleanup();
  const existingPreviewUrl = previewUrls.get(id);
  if (existingPreviewUrl) return existingPreviewUrl;
  let record: StoredListingMedia | null = null;
  try {
    record = await withStore<StoredListingMedia>('readonly', (store) => store.get(id));
  } catch {
    resetDatabaseConnection();
  }
  const stored = record ?? memoryMedia.get(id);
  if (!stored) return null;
  if (stored.dataUrl) return stored.dataUrl;
  if (!(stored.blob instanceof Blob)) return null;
  const previewUrl = URL.createObjectURL(stored.blob);
  previewUrls.set(id, previewUrl);
  return previewUrl;
};

export const deleteListingMedia = async (id: string): Promise<void> => {
  memoryMedia.delete(id);
  const previewUrl = previewUrls.get(id);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrls.delete(id);
  await withStore('readwrite', (store) => store.delete(id));
};

export const deleteListingMediaMany = async (ids: string[]): Promise<void> => {
  await Promise.all(ids.map((id) => deleteListingMedia(id)));
};

/**
 * Remove stale media that is no longer referenced by any persisted draft.
 * The caller supplies its currently loaded references, and this module also
 * scans every actor-scoped local draft bucket because media storage is global.
 * Recent records are retained so a draft opened in another tab can still
 * resolve its preview after a reload.
 */
export const pruneListingMedia = async (
  keepIds: Iterable<string>,
  maxAgeMs = MEDIA_GC_DEFAULT_AGE_MS,
  now = Date.now(),
): Promise<string[]> => {
  const keep = new Set(keepIds);
  for (const id of referencedDraftMediaIds()) keep.add(id);
  const candidates = new Map<string, StoredListingMedia>(memoryMedia);
  try {
    const persisted = await withStore<StoredListingMedia[]>('readonly', (store) => store.getAll());
    for (const record of persisted ?? []) candidates.set(record.id, record);
  } catch {
    resetDatabaseConnection();
    // The in-memory map is still safe to sweep when IndexedDB is unavailable.
  }
  const staleIds = [...candidates.values()]
    .filter((record) => !keep.has(record.id) && now - Date.parse(record.updatedAt) > maxAgeMs)
    .map((record) => record.id);
  if (staleIds.length) await deleteListingMediaMany(staleIds);
  return staleIds;
};

const readBytes = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.slice(0, 64).arrayBuffer());

const hasPrefix = (bytes: Uint8Array, prefix: number[]): boolean => prefix.every((value, index) => bytes[index] === value);

const matchesFileSignature = (file: File, bytes: Uint8Array): boolean => {
  if (file.type === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (file.type === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (file.type === 'image/webp') return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (file.type === 'image/gif') {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (file.type === 'image/avif') {
    if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') return false;
    const brands: string[] = [];
    for (let offset = 8; offset + 4 <= bytes.length; offset += 4) brands.push(String.fromCharCode(...bytes.slice(offset, offset + 4)));
    return brands.includes('avif') || brands.includes('avis');
  }
  return false;
};

export interface PreparedListingMedia {
  ref: ListingMediaRef;
  previewUrl: string;
}

export const prepareListingMedia = async (file: File, source: 'camera' | 'album'): Promise<PreparedListingMedia> => {
  installPreviewCleanup();
  if (!ALLOWED_TYPES.has(file.type) || file.type === 'image/svg+xml') throw new Error('unsupported-image-type');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('image-too-large');
  const bytes = await readBytes(file);
  if (!matchesFileSignature(file, bytes)) throw new Error('image-mime-mismatch');

  let blob: Blob;
  let width: number | undefined;
  let height: number | undefined;
  if (file.type === 'image/gif' || file.type === 'image/avif') {
    blob = file;
    if (typeof globalThis.createImageBitmap === 'function') {
      const bitmap = await globalThis.createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    }
  } else if (typeof globalThis.createImageBitmap === 'function' && typeof document !== 'undefined') {
    const bitmap = await globalThis.createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    width = canvas.width;
    height = canvas.height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      throw new Error('image-processing-failed');
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    try {
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('image-processing-failed')), 'image/webp', 0.82));
    } finally {
      bitmap.close();
    }
  } else {
    blob = file.slice(0, file.size, file.type);
  }
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('image-too-large');

  const id = createListingMediaId();
  const createdAt = new Date().toISOString();
  const ref: ListingMediaRef = {
    id,
    source,
    status: 'ready',
    mimeType: blob.type === 'image/webp' ? 'image/webp' : file.type as ListingMediaRef['mimeType'],
    width,
    height,
    byteSize: blob.size,
    thumbnailRef: id,
    createdAt,
  };
  await putListingMedia(id, blob);
  const previewUrl = URL.createObjectURL(blob);
  previewUrls.set(id, previewUrl);
  return { ref, previewUrl };
};
