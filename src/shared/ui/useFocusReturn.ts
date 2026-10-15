import { useEffect, useLayoutEffect, useRef } from 'react';

/** Remember the element that opened an overlay and return focus to it when the overlay closes. */
export function useFocusReturn(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  const was = useRef(false);
  // A layout effect runs before the dialog's own passive effects move focus inside it, so the opener is still active here.
  useLayoutEffect(() => {
    if (open && !was.current) opener.current = document.activeElement as HTMLElement | null;
    was.current = open;
  }, [open]);
  useEffect(() => {
    if (open) return undefined;
    const el = opener.current;
    if (!el) return undefined;
    opener.current = null;
    const t = window.setTimeout(() => {
      if (document.contains(el)) el.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);
}
