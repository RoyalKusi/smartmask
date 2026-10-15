import type { BootStep, api as serverApi } from './server';

type Server = typeof import('./server');
type ApiShape = typeof serverApi;
type Lazy<T> = {
  [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
};

let loaded: Server | null = null;
let pending: Promise<Server> | null = null;

/** The engine, dataset and simulated server load in their own chunk so the shell can paint first. */
const load = (): Promise<Server> => (pending ??= import('./server').then((m) => (loaded = m)));

export const api: Lazy<ApiShape> = new Proxy({} as Lazy<ApiShape>, {
  get:
    (_t, key: string) =>
    (...args: unknown[]) =>
      load().then((m) => (Reflect.get(m.api, key) as (...a: unknown[]) => unknown).apply(m.api, args)),
});

export function boot(onStep: (s: BootStep) => void): Promise<void> {
  return load().then((m) => {
    m.onBoot(onStep);
    return m.boot();
  });
}

export function subscribeChanges(fn: (keys: string[]) => void): () => void {
  let off: (() => void) | null = null;
  let dead = false;
  void load().then((m) => {
    if (!dead) off = m.subscribeChanges(fn);
  });
  return () => {
    dead = true;
    off?.();
  };
}

/** Synchronous view of the live cache model; falls back to steady state until the server chunk has loaded. */
export function liveCache(): { sinceBump: number | null; ratio: number } {
  return loaded ? loaded.liveCache() : { sinceBump: null, ratio: 0.92 };
}
