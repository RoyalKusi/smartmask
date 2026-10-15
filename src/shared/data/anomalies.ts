import type { AuditEvent } from '../engine/audit';
import { trainIsolationForest } from '../engine/iforest';
import { median, percentile } from '../engine/stats';
import type { Role } from '../engine/types';
import { WINDOW_START } from './auditSeed';
import { PRINCIPALS } from './principals';

export const FEATURES = [
  'Queries',
  'Denied ratio',
  'Tagged columns',
  'Off-hours share',
  'Rows returned',
  'Token joins',
] as const;
export type FeatureName = (typeof FEATURES)[number];

export interface AnomalyAlert {
  id: string;
  principal: string;
  role: Role;
  day: string;
  score: number;
  features: number[];
  /** Fleet 95th percentile per feature, used to normalise the radar. */
  fleetP95: number[];
  baseline: number[];
  summary: string;
  firstSeen: string;
  eventIds: number[];
  status: 'open' | 'acknowledged' | 'dismissed';
}

const IST = 5.5 * 3_600_000;

/** The window opens mid-day, so its first local day is a partial day and would look anomalous by construction. */
const FIRST_PARTIAL_DAY = new Date(WINDOW_START + IST).toISOString().slice(0, 10);

/** One feature vector per principal per local day. */
export function buildAnomalies(
  events: readonly AuditEvent[],
  taggedColumns: ReadonlySet<string>,
): AnomalyAlert[] {
  const groups = new Map<string, AuditEvent[]>();
  for (const e of events) {
    if (e.event_type !== 'QUERY') continue;
    const day = new Date(Date.parse(e.timestamp) + IST).toISOString().slice(0, 10);
    if (day === FIRST_PARTIAL_DAY) continue;
    const key = `${e.principal}|${day}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  const rows: { key: string; principal: string; day: string; vec: number[]; ids: number[]; first: string }[] =
    [];
  for (const [key, evs] of groups) {
    const [principal, day] = key.split('|') as [string, string];
    const tagged = new Set<string>();
    let off = 0;
    let rowsSum = 0;
    let joins = 0;
    for (const e of evs) {
      for (const c of e.columns_accessed) if (taggedColumns.has(c)) tagged.add(c);
      const h = new Date(Date.parse(e.timestamp) + IST).getUTCHours();
      if (h < 7 || h >= 21) off++;
      rowsSum += e.rows_returned;
      if (
        /JOIN|token/i.test(e.detail) ||
        (e.masking_applied.some((m) => m.function === 'HMAC_TOKEN') && e.columns_accessed.length > 4)
      )
        joins++;
    }
    const denied = evs.filter((e) => e.outcome === 'DENIED').length;
    rows.push({
      key,
      principal,
      day,
      vec: [evs.length, denied / evs.length, tagged.size, off / evs.length, rowsSum, joins],
      ids: evs.map((e) => e.id),
      first: evs[0]?.timestamp ?? '',
    });
  }
  const dims = FEATURES.length;
  const cols = Array.from({ length: dims }, (_, f) => rows.map((r) => r.vec[f] as number));
  const mu = cols.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const sd = cols.map(
    (c, f) => Math.sqrt(c.reduce((a, b) => a + (b - (mu[f] as number)) ** 2, 0) / c.length) || 1,
  );
  const z = rows.map((r) => r.vec.map((v, f) => (v - (mu[f] as number)) / (sd[f] as number)));
  const forest = trainIsolationForest(z, { trees: 120, sample: 256, seed: 11 });
  const scored = rows.map((r, i) => ({ r, score: forest.score(z[i] as number[]) }));

  const fleetP95 = cols.map(
    (c) =>
      percentile(
        [...c].sort((a, b) => a - b),
        95,
      ) || 1,
  );
  const alerts: AnomalyAlert[] = [];
  const top = scored
    .filter((s) => s.score >= 0.62)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  top.forEach(({ r, score }, i) => {
    const p = PRINCIPALS.find((x) => x.id === r.principal);
    const own = rows.filter((x) => x.principal === r.principal && x.key !== r.key);
    const baseline = Array.from({ length: dims }, (_, f) => median(own.map((o) => o.vec[f] as number)));
    const [q, d, t, o, , j] = r.vec as [number, number, number, number, number, number];
    const reasons: string[] = [];
    if (d > 0.2) reasons.push(`${Math.round(d * q)} denied queries`);
    if (t >= 6) reasons.push(`${t} distinct tagged columns`);
    if (o > 0.5) reasons.push(`${Math.round(o * 100)}% of queries off-hours`);
    if (q > (fleetP95[0] as number)) reasons.push(`${q} queries in a day`);
    if (j > 10) reasons.push(`${j} multi-table token joins`);
    alerts.push({
      id: `AN-${String(i + 1).padStart(3, '0')}`,
      principal: r.principal,
      role: p?.role ?? 'ROLE_ANALYST',
      day: r.day,
      score,
      features: r.vec,
      fleetP95,
      baseline,
      summary: reasons.join(', ') || 'Unusual combination of activity features',
      firstSeen: r.first,
      eventIds: r.ids,
      status: 'open',
    });
  });
  return alerts;
}
