/**
 * The guided camera lives below ListingView, while the listing media store
 * remains owned by ListingView. This small browser-only bridge lets a camera
 * frame take the exact same path as the existing camera input without
 * widening the controller contract or storing a second copy of the image.
 */

export const dispatchFileToListingInput = (file: File, inputId = 'listing-camera'): boolean => {
  if (typeof document === 'undefined' || typeof DataTransfer === 'undefined') return false;

  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement)) return false;

  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
};
