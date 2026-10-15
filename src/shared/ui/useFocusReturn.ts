import { useEffect, useRef } from 'react';

/** Remember the element that opened an overlay and return focus to it when the overlay closes. */
export function useFocusReturn(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  const was = useRef(false);
  useEffect(() => {
    if (open && !was.current) opener.current = document.activeElement as HTMLElement | null;
    if (!open && was.current) {
      const el = opener.current;
      if (el && document.contains(el)) setTimeout(() => el.focus(), 0);
    }
    was.current = open;
  }, [open]);
}
