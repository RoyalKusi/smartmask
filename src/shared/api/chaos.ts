import { useSyncExternalStore } from 'react';

export interface ChaosFlags {
  /** Reads fail with HTTP 500. */
  fail500: boolean;
  /** Reads hang, then time out. */
  timeout: boolean;
  /** The catalog service is unavailable (SM-CAT-001). */
  catalogOutage: boolean;
  /** The audit queue refuses writes (SM-AUDIT-001). */
  auditFull: boolean;
}

let flags: ChaosFlags = { fail500: false, timeout: false, catalogOutage: false, auditFull: false };
const listeners = new Set<() => void>();

export const getChaos = (): ChaosFlags => flags;
export function setChaos(patch: Partial<ChaosFlags>): void {
  flags = { ...flags, ...patch };
  listeners.forEach((l) => l());
}
export const anyChaos = (f: ChaosFlags = flags): boolean => f.fail500 || f.timeout || f.catalogOutage || f.auditFull;
export function useChaos(): ChaosFlags {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getChaos);
}
