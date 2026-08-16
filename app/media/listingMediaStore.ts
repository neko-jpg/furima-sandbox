import type { ListingMediaRef } from '../types/mercari';

const DB_NAME = 'furima-listing-media-v1';
const STORE_NAME = 'media';
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

const hasIndexedDb = (): boolean => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  });
};

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const database = await openDatabase().catch(() => null);
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-request-failed'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb-transaction-failed'));
  });
};

export const createListingMediaId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `media_${globalThis.crypto.randomUUID()}`;
  return `media_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const putListingMedia = async (id: string, blob: Blob): Promise<void> => {
  const record: StoredListingMedia = { id, blob, updatedAt: new Date().toISOString() };
  memoryMedia.set(id, record);
  await withStore('readwrite', (store) => store.put(record)).catch(() => undefined);
};

export const getListingMedia = async (id: string): Promise<string | null> => {
  const existingPreviewUrl = previewUrls.get(id);
  if (existingPreviewUrl) return existingPreviewUrl;
  const record = await withStore<StoredListingMedia>('readonly', (store) => store.get(id)).catch(() => null);
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
  await withStore('readwrite', (store) => store.delete(id)).catch(() => undefined);
};

export const deleteListingMediaMany = async (ids: string[]): Promise<void> => {
  await Promise.all(ids.map((id) => deleteListingMedia(id)));
};

const readBytes = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.slice(0, 16).arrayBuffer());

const hasPrefix = (bytes: Uint8Array, prefix: number[]): boolean => prefix.every((value, index) => bytes[index] === value);

const matchesFileSignature = (file: File, bytes: Uint8Array): boolean => {
  if (file.type === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (file.type === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (file.type === 'image/webp') return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (file.type === 'image/gif') return String.fromCharCode(...bytes.slice(0, 4)) === 'GIF8';
  if (file.type === 'image/avif') return String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  return false;
};

export interface PreparedListingMedia {
  ref: ListingMediaRef;
  previewUrl: string;
}

export const prepareListingMedia = async (file: File, source: 'camera' | 'album'): Promise<PreparedListingMedia> => {
  if (!ALLOWED_TYPES.has(file.type) || file.type === 'image/svg+xml') throw new Error('unsupported-image-type');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('image-too-large');
  const bytes = await readBytes(file);
  if (!matchesFileSignature(file, bytes)) throw new Error('image-mime-mismatch');

  let blob: Blob;
  let width: number | undefined;
  let height: number | undefined;
  if (typeof globalThis.createImageBitmap === 'function' && typeof document !== 'undefined') {
    const bitmap = await globalThis.createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
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
