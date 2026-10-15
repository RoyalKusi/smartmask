import { useCallback, useSyncExternalStore } from 'react';

export type ViewId = 'overview' | 'discovery' | 'review' | 'policy' | 'workbench' | 'verification' | 'audit' | 'performance' | 'anomalies';
export const VIEW_IDS: readonly ViewId[] = ['overview', 'discovery', 'review', 'policy', 'workbench', 'verification', 'audit', 'performance', 'anomalies'];

/** Params that follow the user across views. Everything else is view-specific and is dropped on navigation. */
const GLOBAL_PARAMS = ['role', 'theme', 'fast'];

interface Route {
  view: ViewId;
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const view = (VIEW_IDS as readonly string[]).includes(path) ? (path as ViewId) : 'overview';
  return { view, params: new URLSearchParams(query) };
}

function build(view: ViewId, params: URLSearchParams): string {
  const q = params.toString();
  return `#/${view}${q ? `?${q}` : ''}`;
}

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const snapshot = (): string => window.location.hash;

export function currentRoute(): Route {
  return parse(window.location.hash);
}

function write(next: string, replace: boolean): void {
  if (next === window.location.hash) return;
  const url = `${window.location.pathname}${window.location.search}${next}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  notify();
}

export type ParamPatch = Record<string, string | null | undefined>;

export function navigate(view: ViewId, patch: ParamPatch = {}, opts: { replace?: boolean } = {}): void {
  const cur = currentRoute();
  const next = new URLSearchParams();
  for (const k of GLOBAL_PARAMS) {
    const v = cur.params.get(k);
    if (v !== null) next.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  write(build(view, next), opts.replace ?? false);
}

export function setParams(patch: ParamPatch, opts: { replace?: boolean } = {}): void {
  const cur = currentRoute();
  const next = new URLSearchParams(cur.params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  write(build(cur.view, next), opts.replace ?? false);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  return parse(hash);
}

/** A single URL-backed string parameter. Filters, sorts and tabs use this so they survive refresh and Back/Forward. */
export function useParam(key: string, fallback = ''): [string, (v: string | null, replace?: boolean) => void] {
  const { params } = useRoute();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (v: string | null, replace = true) => setParams({ [key]: v === fallback ? null : v }, { replace }),
    [key, fallback],
  );
  return [value, set];
}

export function useListParam(key: string): [string[], (v: string[], replace?: boolean) => void] {
  const [raw, set] = useParam(key, '');
  const list = raw ? raw.split(',').filter(Boolean) : [];
  return [list, (v, replace = true) => set(v.length ? v.join(',') : null, replace)];
}

export type RoleParam = 'admin' | 'support' | 'analyst';
export const ROLE_PARAMS: readonly RoleParam[] = ['admin', 'support', 'analyst'];
export const roleFromParam = (p: string | null): 'ROLE_ADMIN' | 'ROLE_SUPPORT' | 'ROLE_ANALYST' =>
  p === 'support' ? 'ROLE_SUPPORT' : p === 'analyst' ? 'ROLE_ANALYST' : 'ROLE_ADMIN';
export const roleToParam = (r: 'ROLE_ADMIN' | 'ROLE_SUPPORT' | 'ROLE_ANALYST'): RoleParam =>
  r === 'ROLE_SUPPORT' ? 'support' : r === 'ROLE_ANALYST' ? 'analyst' : 'admin';

export function useRole(): 'ROLE_ADMIN' | 'ROLE_SUPPORT' | 'ROLE_ANALYST' {
  const { params } = useRoute();
  return roleFromParam(params.get('role'));
}
