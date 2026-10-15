/**
 * Minimal explicit finite-state machine. Every transition is declared in a table;
 * an event that has no declared transition is rejected (returns the same state and `ok: false`).
 */
export type LoadState = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'retrying';
export type LoadEvent = 'FETCH' | 'RESOLVE' | 'RESOLVE_EMPTY' | 'REJECT' | 'RETRY' | 'RESET';

export type TransitionTable<S extends string, E extends string> = Readonly<Record<S, Partial<Record<E, S>>>>;

export const LOAD_TRANSITIONS: TransitionTable<LoadState, LoadEvent> = {
  idle: { FETCH: 'loading', RESET: 'idle' },
  loading: { RESOLVE: 'success', RESOLVE_EMPTY: 'empty', REJECT: 'error', RESET: 'idle' },
  success: { FETCH: 'loading', RESOLVE_EMPTY: 'empty', RESET: 'idle' },
  empty: { FETCH: 'loading', RESOLVE: 'success', RESET: 'idle' },
  error: { RETRY: 'retrying', FETCH: 'loading', RESET: 'idle' },
  retrying: { RESOLVE: 'success', RESOLVE_EMPTY: 'empty', REJECT: 'error', RESET: 'idle' },
};

export function transition<S extends string, E extends string>(
  table: TransitionTable<S, E>,
  state: S,
  event: E,
): { state: S; ok: boolean } {
  const next = table[state][event];
  return next === undefined ? { state, ok: false } : { state: next, ok: true };
}

export type QueryStage = 'idle' | 'parse' | 'validate' | 'rewrite' | 'execute' | 'mask' | 'audit' | 'done' | 'rejected' | 'failed';
export type QueryEvent = 'RUN' | 'NEXT' | 'REJECT' | 'FAIL' | 'RESET';

export const QUERY_TRANSITIONS: TransitionTable<QueryStage, QueryEvent> = {
  idle: { RUN: 'parse' },
  parse: { NEXT: 'validate', REJECT: 'rejected', FAIL: 'failed' },
  validate: { NEXT: 'rewrite', REJECT: 'rejected', FAIL: 'failed' },
  rewrite: { NEXT: 'execute', FAIL: 'failed' },
  execute: { NEXT: 'mask', FAIL: 'failed' },
  mask: { NEXT: 'audit', FAIL: 'failed' },
  audit: { NEXT: 'done', FAIL: 'failed', REJECT: 'rejected' },
  done: { RUN: 'parse', RESET: 'idle' },
  rejected: { RUN: 'parse', RESET: 'idle' },
  failed: { RUN: 'parse', RESET: 'idle' },
};

export type ScanStage = 'idle' | 'connect' | 'catalog' | 'sample' | 'score' | 'classify' | 'complete' | 'failed';
export type ScanEvent = 'START' | 'NEXT' | 'FAIL' | 'RESET';
export const SCAN_STAGES: readonly ScanStage[] = ['connect', 'catalog', 'sample', 'score', 'classify'];
export const SCAN_TRANSITIONS: TransitionTable<ScanStage, ScanEvent> = {
  idle: { START: 'connect' },
  connect: { NEXT: 'catalog', FAIL: 'failed' },
  catalog: { NEXT: 'sample', FAIL: 'failed' },
  sample: { NEXT: 'score', FAIL: 'failed' },
  score: { NEXT: 'classify', FAIL: 'failed' },
  classify: { NEXT: 'complete', FAIL: 'failed' },
  complete: { START: 'connect', RESET: 'idle' },
  failed: { START: 'connect', RESET: 'idle' },
};
