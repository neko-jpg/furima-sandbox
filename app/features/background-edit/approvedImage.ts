import { encodeImageForOutput } from './canvasComposite.ts';
import type { BackgroundEditState } from './backgroundEditReducer.ts';

const DOWNLOADABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

const approvedBlob = (state: BackgroundEditState): Blob | null => (
  state.phase === 'approved' && state.approvedBlob && state.approvedOutput ? state.approvedBlob : null
);

/**
 * Returns only the explicitly approved front image. A preview or an image from
 * a processing state can never reach this boundary.
 */
export async function getApprovedImageForDownload(state: BackgroundEditState): Promise<Blob | null> {
  const blob = approvedBlob(state);
  if (!blob) return null;
  if (DOWNLOADABLE_MIME_TYPES.has(blob.type)) return blob;
  return encodeImageForOutput(blob, 'image/png');
}

/** Trigger a browser download for the approved front image only. */
export async function downloadApprovedImage(
  state: BackgroundEditState,
  filename = 'furima-front-approved.png',
): Promise<boolean> {
  const blob = await getApprovedImageForDownload(state);
  if (!blob || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = blob.type === 'image/jpeg' ? filename.replace(/\.png$/u, '.jpg') : filename;
    anchor.click();
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
