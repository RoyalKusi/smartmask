import { useSyncExternalStore } from 'react';

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
export const useCompact = (): boolean => useMedia('(max-width: 639px)');
export const useReducedMotion = (): boolean => useMedia('(prefers-reduced-motion: reduce)');
