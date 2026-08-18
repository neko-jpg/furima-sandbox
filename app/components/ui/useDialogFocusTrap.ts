import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export const useDialogFocusTrap = (
  dialogRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void => {
  useEffect(() => {
    if (!active) return undefined;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusFirst = () => dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const frame = window.requestAnimationFrame(focusFirst);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElement?.isConnected) previousActiveElement.focus({ preventScroll: true });
    };
  }, [active, dialogRef, onEscape]);
};
