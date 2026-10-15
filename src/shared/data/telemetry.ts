import type { AuditEvent } from '../engine/audit';
import { createRng } from '../engine/prng';
import { mean, percentile } from '../engine/stats';
import { ROLES, type Role } from '../engine/types';
import { WINDOW_MINUTES, WINDOW_START } from './auditSeed';
import { POLICY_HISTORY } from './principals';

export interface HourBucket {
  start: number;
  counts: Record<Role, number>;
  total: number;
  denied: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  stages: { parse: number; policy: number; mutation: number; render: number; audit: number };
}

export interface Telemetry {
  start: number;
  minutes: number;
  /** Per-minute query counts by role over 14 days. */
  perMinute: Record<Role, Uint16Array>;
  /** Per-minute simulated cache hit ratio (0..1). */
  cacheHit: Float32Array;
  hours: HourBucket[];
  /** Minute indexes where policy_version changed (cache invalidations). */
  policyBumps: number[];
}

export const CACHE_BASELINE = 0.92;

/** Cache model: a policy_version bump invalidates entries, then the hit ratio recovers exponentially. */
export function cacheRatio(secondsSinceBump: number | null, noise = 0): number {
  if (secondsSinceBump === null) return Math.min(0.99, CACHE_BASELINE + noise);
  const dip = 0.62 * Math.exp(-secondsSinceBump / 240);
  return Math.max(0.2, Math.min(0.99, CACHE_BASELINE - dip + noise));
}

export function buildTelemetry(events: readonly AuditEvent[]): Telemetry {
  const minutes = WINDOW_MINUTES;
  const perMinute = {} as Record<Role, Uint16Array>;
  for (const r of ROLES) perMinute[r] = new Uint16Array(minutes);
  const hourEvents: AuditEvent[][] = Array.from({ length: minutes / 60 }, () => []);
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    const m = Math.floor((t - WINDOW_START) / 60_000);
    if (m < 0 || m >= minutes) continue;
    const arr = perMinute[e.requesting_role];
    arr[m] = (arr[m] as number) + 1;
    (hourEvents[Math.floor(m / 60)] as AuditEvent[]).push(e);
  }

  const bumps = POLICY_HISTORY.map((p) =>
    Math.floor((Date.parse(`${p.at.replace(' ', 'T')}Z`) - WINDOW_START) / 60_000),
  ).filter((m) => m >= 0 && m < minutes);
  const rng = createRng('cache-series');
  const cacheHit = new Float32Array(minutes);
  let lastBump: number | null = null;
  for (let m = 0; m < minutes; m++) {
    if (bumps.includes(m)) lastBump = m;
    const since = lastBump === null ? null : (m - lastBump) * 60;
    cacheHit[m] = cacheRatio(since, rng.normal() * 0.008);
  }

  const hours: HourBucket[] = hourEvents.map((evs, h) => {
    const counts = { ROLE_ADMIN: 0, ROLE_SUPPORT: 0, ROLE_ANALYST: 0 } as Record<Role, number>;
    const ms = evs.map((e) => e.execution_time_ms).sort((a, b) => a - b);
    for (const e of evs) counts[e.requesting_role]++;
    const st = (k: 'parse' | 'policy' | 'mutation' | 'render' | 'audit'): number =>
      mean(evs.map((e) => e.stages?.[k] ?? 0));
    return {
      start: WINDOW_START + h * 3_600_000,
      counts,
      total: evs.length,
      denied: evs.filter((e) => e.outcome === 'DENIED').length,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      p99: percentile(ms, 99),
      max: ms[ms.length - 1] ?? 0,
      stages: {
        parse: st('parse'),
        policy: st('policy'),
        mutation: st('mutation'),
        render: st('render'),
        audit: st('audit'),
      },
    };
  });
  return { start: WINDOW_START, minutes, perMinute, cacheHit, hours, policyBumps: bumps };
}
