import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NotifyOptions } from './notifyTypes';

export type { NotifyOptions } from './notifyTypes';

type Notify = (o: NotifyOptions) => void;
const Ctx = createContext<Notify>(() => undefined);
const ToasterHost = lazy(() => import('./ToasterHost'));

/**
 * Toasts are acrylic, top-right, stacked, 5 s, pause on hover, announced politely, with Undo for reversible actions.
 * The Fluent toast machinery loads on the first notification, so routes that never toast never pay for it.
 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const queue = useRef<NotifyOptions[]>([]);
  const [mounted, setMounted] = useState(false);
  const [drain, setDrain] = useState<((o: NotifyOptions) => void) | null>(null);
  const notify = useCallback<Notify>(
    (o) => {
      if (drain) drain(o);
      else {
        queue.current.push(o);
        setMounted(true);
      }
    },
    [drain],
  );
  const value = useMemo(() => notify, [notify]);
  return (
    <Ctx.Provider value={value}>
      {mounted && (
        <Suspense fallback={null}>
          <ToasterHost
            onReady={(fn) => {
              queue.current.splice(0).forEach(fn);
              setDrain(() => fn);
            }}
          />
        </Suspense>
      )}
      {children}
    </Ctx.Provider>
  );
}

export const useNotify = (): Notify => useContext(Ctx);
