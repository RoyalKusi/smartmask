import { sealEvent, tamper as tamperEvents, verifyChain, GENESIS_HASH, type AuditBody, type AuditEvent, type ChainVerdict } from '../engine/audit';
import { sha256HexSync } from '../engine/hash';
import { TokenVault } from '../engine/masking';
import { runPipeline, type StageTimings } from '../engine/pipeline';
import { DEFAULT_POLICY, DEFAULT_POLICY_YAML } from '../engine/defaultPolicy';
import type { CopilotResult } from '../engine/policy';
import type { Policy } from '../engine/policyCore';

/** The YAML parser is loaded only when a policy is validated, drafted or saved. */
const yamlEngine = (): Promise<typeof import('../engine/policy')> => import('../engine/policy');
import { createRng } from '../engine/prng';
import { mean, percentile } from '../engine/stats';
import { SCAN_STAGES, type ScanStage } from '../engine/fsm';
import { EngineError, ROLES, type Role, type Tag, type Violation } from '../engine/types';
import { buildAnomalies, type AnomalyAlert } from '../data/anomalies';
import { AUDIT_TOTAL, buildSeedAudit } from '../data/auditSeed';
import { effectiveTag, scanAll, scanBackend, type ColumnRecord, type Decision } from '../data/catalog';
import { dataset } from '../data/dataset';
import { GOLDEN_QUERIES } from '../data/golden';
import { DAY, DEMO_NOW, iso } from '../data/pool';
import { POLICY_HISTORY, PRINCIPALS, type PolicyVersionLog, type ScanLog } from '../data/principals';
import { approachOf, dialectOf, makeTagInfo, schemaLookup } from '../data/runtime';
import { BACKENDS, TABLES, tableByName } from '../data/schema';
import { buildTelemetry, cacheRatio, type Telemetry } from '../data/telemetry';
import { getChaos } from './chaos';
import { DEFAULT_PRINCIPAL } from './identity';
import { ApiError } from './errors';
import { triage } from './triage';
import type {
  ActivityItem, AuditData, BackendInfo, DecisionInput, GoldenDiffRow, OverviewData, PerformanceData, PolicyData,
  QueryRunResult, ReviewItem, ScanProgress, ScanSummary, VerificationBatch,
} from './types';

export { DEFAULT_PRINCIPAL };

interface ServerState {
  records: Map<string, ColumnRecord>;
  policyText: string;
  policy: Policy;
  policyLog: PolicyVersionLog[];
  audit: AuditEvent[];
  tamper: { index: number; original: AuditEvent } | null;
  verdict: (ChainVerdict & { at: string }) | null;
  alerts: AnomalyAlert[];
  telemetry: Telemetry;
  activity: ActivityItem[];
  baseline: Map<string, string>;
  verification: VerificationBatch[];
  backends: BackendInfo[];
  scanLog: ScanLog[];
  bumpsLive: number;
  lastBumpWall: number | null;
  planCache: Set<string>;
  vault: TokenVault;
  wallBase: number;
}

let state: ServerState | null = null;
let bootPromise: Promise<void> | null = null;
let seq = 0;
export type BootStep = { label: string; pct: number };
let bootListener: ((s: BootStep) => void) | null = null;
export const onBoot = (fn: (s: BootStep) => void): void => {
  bootListener = fn;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Change notifications so the UI can invalidate queries after server-side writes. */
const changeListeners = new Set<(keys: string[]) => void>();
let pendingKeys = new Set<string>();
export const subscribeChanges = (fn: (keys: string[]) => void): (() => void) => {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
};
function emit(...keys: string[]): void {
  const first = pendingKeys.size === 0;
  keys.forEach((k) => pendingKeys.add(k));
  if (!first) return;
  queueMicrotask(() => {
    const out = [...pendingKeys];
    pendingKeys = new Set();
    changeListeners.forEach((l) => l(out));
  });
}
export const demoNow = (): number => DEMO_NOW + (Date.now() - (state?.wallBase ?? Date.now()));
const nowIso = (): string => new Date(demoNow()).toISOString();
const nowStamp = (): string => iso(demoNow());

function st(): ServerState {
  if (!state) throw new ApiError('SM-API-503', 'The simulated engine is still starting.', 503);
  return state;
}

export function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    const report = (label: string, pct: number): void => bootListener?.({ label, pct });
    const wallBase = Date.now();
    report('Generating synthetic bank data', 8);
    await tick();
    const scannedAt = iso(DEMO_NOW - 9 * 3_600_000);
    const recs = scanAll(scannedAt);
    const records = new Map(recs.map((r) => [r.id, r]));
    report('Scoring 192 columns', 30);
    await tick();
    seedDecisions(records);
    report('Sealing 8,000 audit events with SHA-256', 55);
    await tick();
    const policy = DEFAULT_POLICY;
    const audit = await buildSeedAudit({ policy, schema: schemaLookup, tagInfo: makeTagInfo(records) });
    report('Building telemetry and anomaly model', 82);
    await tick();
    const telemetry = buildTelemetry(audit);
    const tagged = new Set([...records.values()].filter((r) => r.state !== 'CLEAR').map((r) => r.id));
    const alerts = buildAnomalies(audit, tagged);
    const verdict = await verifyChain(audit);
    const backends: BackendInfo[] = BACKENDS.map((b) => ({
      id: b.id, label: b.label, dialect: b.dialect, engine: b.engine, approach: b.approach,
      host: b.id === 'core_pg' ? 'pg-core.meridian.internal:5432' : b.id === 'ledger_lite' ? 'file:/var/lib/ledger/ledger.db' : 'mysql-crm.meridian.internal:3306',
      status: 'connected',
      tables: TABLES.filter((t) => t.backend === b.id).length,
      columns: recs.filter((r) => r.backend === b.id).length,
      lastScan: scannedAt,
      custom: false,
    }));
    const scanLog: ScanLog[] = BACKENDS.flatMap((b, bi) =>
      [0, 1, 2].map((k) => {
        const rs = recs.filter((r) => r.backend === b.id);
        return {
          id: `scan-${b.id}-${k}`,
          at: iso(DEMO_NOW - (9 + k * 7 * 24 + bi) * 3_600_000),
          backend: b.id,
          columns: rs.length,
          enforced: rs.filter((r) => r.state === 'ENFORCED' || r.state === 'ENFORCED_ML').length,
          review: rs.filter((r) => r.state === 'REVIEW').length,
          durationMs: 2400,
        };
      }),
    );
    state = {
      records, policyText: DEFAULT_POLICY_YAML, policy, policyLog: [...POLICY_HISTORY], audit, tamper: null,
      verdict: { ...verdict, at: nowStamp() }, alerts, telemetry, activity: seedActivity(records, audit), baseline: new Map(), verification: [],
      backends, scanLog, bumpsLive: 0, lastBumpWall: null, planCache: new Set(), vault: new TokenVault('meridian-demo-master-secret'), wallBase,
    };
    report('Ready', 100);
  })();
  return bootPromise;
}

function seedDecisions(records: Map<string, ColumnRecord>): void {
  const confirmations: [string, string, string][] = [
    ['customers.ssn', 'a.mehta', 'Confirmed SSN-style identifier; no exceptions requested.'],
    ['cards.card_no', 'o.taylor', 'PAN confirmed against PCI scope list.'],
    ['accounts.balance', 'n.sibanda', 'Balance remains FINANCIAL_CONFIDENTIAL per data classification policy.'],
    ['customers.aadhaar_no', 'o.taylor', 'Aadhaar numbers must never be shown to Support unmasked.'],
    ['legacy_cards.card_no_legacy', 'a.mehta', 'Luhn failure is a legacy migration artefact, still treated as a card number.'],
  ];
  confirmations.forEach(([id, by, reason], i) => {
    const r = records.get(id);
    if (!r) return;
    r.history.push({ at: iso(DEMO_NOW - (30 + i * 11) * 3_600_000 * 24 / 10), by, action: 'APPROVE', from: r.state, to: r.state, reason });
  });
}

function seedActivity(records: Map<string, ColumnRecord>, audit: AuditEvent[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  const rev = [...records.values()].filter((r) => r.state === 'REVIEW').length;
  items.push({ id: 'seed-scan', at: iso(DEMO_NOW - 9 * 3_600_000), kind: 'scan', title: 'Scheduled scan completed', detail: `3 backends, ${records.size} columns, ${rev} awaiting review`, actor: 'scanner', tone: 'ok' });
  for (const p of POLICY_HISTORY.slice(-3)) items.push({ id: `seed-pol-${p.version}`, at: p.at, kind: 'policy', title: `Policy v${p.version} published`, detail: p.reason, actor: p.author, tone: 'info' });
  items.push({ id: 'seed-alert', at: '2026-10-12 02:25:00', kind: 'alert', title: 'Anomaly raised: denied probe burst', detail: 't.chikwanha issued 40 denied card_no probes, then swept 11 tagged columns', actor: 'isolation-forest', tone: 'bad' });
  items.push({ id: 'seed-alert2', at: '2026-10-10 16:05:00', kind: 'alert', title: 'Anomaly raised: weekend bulk read', detail: 'a.kulkarni read identifier columns 120 times in one hour', actor: 'isolation-forest', tone: 'warn' });
  items.push({ id: 'seed-chain', at: iso(DEMO_NOW - 3_600_000), kind: 'audit', title: 'Audit chain verified', detail: `${audit.length.toLocaleString()} events, no breaks`, actor: 'verifier', tone: 'ok' });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------- plumbing: latency, chaos ---------- */
const latRng = createRng('latency');
const fast = (): boolean => typeof location !== 'undefined' && /[?&]fast=1/.test(location.hash + location.search);
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, fast() ? 0 : ms));
export const readLatency = (): number => Math.round(latRng.float(120, 400));

async function read<T>(fn: () => T | Promise<T>, opts: { catalog?: boolean } = {}): Promise<T> {
  await boot();
  await wait(readLatency());
  const c = getChaos();
  if (c.timeout) {
    await wait(3000);
    throw new ApiError('SM-API-408', 'The request timed out after 3 s.', 408, 'GET /api/v1/… → no response within 3000 ms (injected by Chaos).');
  }
  if (c.fail500) throw new ApiError('SM-API-500', 'The simulated engine returned an internal error.', 500, 'HTTP 500 Internal Server Error (injected by Chaos)\n  at smartmask.engine.handle(request)');
  if (c.catalogOutage && opts.catalog) throw new ApiError('SM-CAT-001', 'The discovery catalog is unavailable.', 503, 'catalog.connect: ECONNREFUSED 10.4.2.17:5433 (injected by Chaos)');
  return fn();
}

/* ---------- audit append ---------- */
export function appendAudit(partial: Partial<AuditBody> & Pick<AuditBody, 'event_type' | 'principal' | 'requesting_role' | 'detail'>): AuditEvent {
  const s = st();
  const prev = s.audit[s.audit.length - 1];
  const body: AuditBody = {
    id: (prev?.id ?? 0) + 1,
    timestamp: nowIso(),
    backend: 'core_pg',
    query_hash: null,
    columns_accessed: [],
    masking_applied: [],
    execution_time_ms: 0,
    rows_returned: 0,
    stages: null,
    outcome: 'ALLOWED',
    code: null,
    policy_version: s.policy.version,
    ...partial,
  };
  const ev = sealEvent(body, prev?.event_hash ?? GENESIS_HASH);
  s.audit = [...s.audit, ev];
  emit('audit', 'overview');
  return ev;
}

function activity(kind: ActivityItem['kind'], title: string, detail: string, actor: string, tone: ActivityItem['tone']): void {
  const s = st();
  s.activity = [{ id: `act-${++seq}`, at: nowStamp(), kind, title, detail, actor, tone }, ...s.activity].slice(0, 60);
  emit('overview');
}

/* ---------- catalog ---------- */
export const api = {
  async overview(): Promise<OverviewData> {
    return read(() => {
      const s = st();
      const recs = [...s.records.values()];
      const masked = (r: ColumnRecord) => effectiveTag(r) !== null;
      const end = demoNow();
      const since = end - DAY;
      const q24 = s.audit.filter((e) => e.event_type === 'QUERY' && Date.parse(e.timestamp) >= since && e.outcome === 'ALLOWED');
      const all24 = s.audit.filter((e) => e.event_type === 'QUERY' && Date.parse(e.timestamp) >= since);
      const hourStart = Math.floor(end / 3_600_000) * 3_600_000;
      const volume = Array.from({ length: 24 }, (_, i) => {
        const start = hourStart - (23 - i) * 3_600_000;
        return { hour: new Date(start + 5.5 * 3_600_000).toISOString().slice(11, 13) + ':00', start, ROLE_ADMIN: 0, ROLE_SUPPORT: 0, ROLE_ANALYST: 0 };
      });
      for (const e of all24) {
        const idx = Math.floor((Date.parse(e.timestamp) - (hourStart - 23 * 3_600_000)) / 3_600_000);
        const b = volume[Math.min(23, Math.max(0, idx))];
        if (b) b[e.requesting_role]++;
      }
      const tagCount = (t: Tag) => recs.filter((r) => effectiveTag(r)?.tag === t && r.state !== 'REVIEW').length;
      return {
        columnsDiscovered: recs.length,
        enforced: recs.filter((r) => r.state === 'ENFORCED' || r.state === 'ENFORCED_ML' || (r.state === 'OVERRIDDEN' && masked(r))).length,
        review: recs.filter((r) => r.state === 'REVIEW').length,
        queries24h: q24.length,
        p99: percentile(all24.map((e) => e.execution_time_ms).sort((a, b) => a - b), 99),
        volume,
        tagDistribution: [
          { tag: 'PII_HIGH', count: tagCount('PII_HIGH') },
          { tag: 'FINANCIAL_CONFIDENTIAL', count: tagCount('FINANCIAL_CONFIDENTIAL') },
          { tag: 'PII_MEDIUM', count: tagCount('PII_MEDIUM') },
          { tag: 'CLEAR', count: recs.filter((r) => effectiveTag(r) === null || r.state === 'REVIEW').length },
        ],
        activity: s.activity.slice(0, 14),
      };
    });
  },

  async columns(): Promise<ColumnRecord[]> {
    return read(() => [...st().records.values()], { catalog: true });
  },

  async column(id: string): Promise<ColumnRecord | null> {
    return read(() => st().records.get(id) ?? null, { catalog: true });
  },

  async backends(): Promise<BackendInfo[]> {
    return read(() => st().backends.map((b) => ({ ...b, columns: [...st().records.values()].filter((r) => r.backend === b.id).length })));
  },

  async addBackend(cfg: { label: string; dialect: BackendInfo['dialect']; host: string }): Promise<BackendInfo> {
    await boot();
    await wait(readLatency() + 500);
    const s = st();
    const id = cfg.label.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (s.backends.some((b) => b.id === id)) throw new ApiError('SM-CAT-003', `A backend named "${id}" already exists.`, 409);
    const engine = cfg.dialect === 'postgresql' ? 'PostgreSQL' : cfg.dialect === 'mysql' ? 'MySQL' : 'SQLite';
    const b: BackendInfo = {
      id, label: id, dialect: cfg.dialect, engine, approach: cfg.dialect === 'postgresql' ? 'views' : 'ast', host: cfg.host,
      status: 'connected', tables: 0, columns: 0, lastScan: null, custom: true,
    };
    s.backends = [...s.backends, b];
    emit('backends');
    appendAudit({ event_type: 'BACKEND_ADDED', principal: DEFAULT_PRINCIPAL.ROLE_ADMIN, requesting_role: 'ROLE_ADMIN', backend: id, detail: `Registered ${engine} backend ${id} (${cfg.host})` });
    activity('backend', `Backend ${id} added`, `${engine} at ${cfg.host}`, DEFAULT_PRINCIPAL.ROLE_ADMIN, 'info');
    return b;
  },

  /** Scan with five stages over ~2.4 s. Rows are revealed progressively. */
  async scan(backend: string, onProgress: (p: ScanProgress) => void, signal?: AbortSignal): Promise<ScanSummary> {
    await boot();
    const s = st();
    const t0 = Date.now();
    const durations: Record<string, number> = { connect: 300, catalog: 500, sample: 700, score: 600, classify: 300 };
    const fresh = backend && BACKENDS.some((b) => b.id === backend) ? scanBackend(backend, nowStamp()) : [];
    const existing = [...s.records.values()].filter((r) => r.backend === backend);
    const merged = fresh.map((f) => {
      const old = s.records.get(f.id);
      if (old) {
        const human = [...old.history].reverse().find((h) => h.action !== 'SCAN' && h.action !== 'DRIFT' && h.from !== h.to);
        if (human && (old.state === 'OVERRIDDEN' || old.state === 'CLEAR' || old.state === 'ENFORCED')) {
          return { ...f, state: old.state, tag: old.tag, override: old.override, history: [...old.history, { at: nowStamp(), by: 'scanner', action: 'SCAN' as const, from: old.state, to: old.state, reason: 'Re-scored; human decision retained' }] };
        }
        return { ...f, history: [...old.history, { at: nowStamp(), by: 'scanner', action: 'SCAN' as const, from: old.state, to: f.state, reason: `Re-scored S=${f.s.toFixed(3)}` }], override: old.override };
      }
      return f;
    });
    const added = merged.filter((m) => !s.records.has(m.id)).map((m) => m.id);
    const removed = existing.filter((r) => !merged.some((m) => m.id === r.id)).map((r) => r.id);
    const speed = fast() ? 0 : 1;
    let elapsed = 0;
    const total = Object.values(durations).reduce((a, b) => a + b, 0);
    for (const stage of SCAN_STAGES) {
      const dur = (durations[stage] as number) * speed;
      if (signal?.aborted) throw new ApiError('SM-SCAN-499', 'Scan cancelled.', 499);
      if (stage === 'catalog' && getChaos().catalogOutage) {
        await wait(durations.catalog as number / 2);
        throw new ApiError('SM-CAT-001', 'The discovery catalog is unavailable.', 503, 'catalog.connect: ECONNREFUSED 10.4.2.17:5433 (injected by Chaos)');
      }
      if (getChaos().fail500 && stage === 'sample') throw new ApiError('SM-API-500', 'The sampler returned an internal error.', 500, 'HTTP 500 from /sampler');
      const steps = stage === 'score' || stage === 'classify' ? 6 : 1;
      for (let i = 0; i < steps; i++) {
        await new Promise((r) => setTimeout(r, dur / steps));
        elapsed += (durations[stage] as number) / steps;
        const upto = stage === 'score' ? Math.round(((i + 1) / steps) * merged.length * 0.7) : stage === 'classify' ? Math.round(merged.length * (0.7 + ((i + 1) / steps) * 0.3)) : 0;
        onProgress({ stage: stage as ScanStage, pct: Math.min(100, Math.round((elapsed / total) * 100)), revealed: merged.slice(0, upto) });
      }
    }
    for (const id of removed) s.records.delete(id);
    for (const m of merged) s.records.set(m.id, m);
    emit('columns', 'review', 'backends', 'overview');
    const enforced = merged.filter((r) => r.state === 'ENFORCED' || r.state === 'ENFORCED_ML').length;
    const review = merged.filter((r) => r.state === 'REVIEW').length;
    const b = s.backends.find((x) => x.id === backend);
    if (b) {
      b.lastScan = nowStamp();
      b.tables = TABLES.filter((t) => t.backend === backend).length;
    }
    const durationMs = Date.now() - t0;
    s.scanLog = [{ id: `scan-${++seq}`, at: nowStamp(), backend, columns: merged.length, enforced, review, durationMs }, ...s.scanLog];
    appendAudit({ event_type: 'SCAN', principal: 'scanner', requesting_role: 'ROLE_ADMIN', backend, detail: `Scanned ${backend}: ${merged.length} columns, ${enforced} enforced, ${review} in review${added.length ? `, ${added.length} new` : ''}${removed.length ? `, ${removed.length} removed` : ''}` });
    activity('scan', `Scan of ${backend} completed`, `${merged.length} columns · ${enforced} enforced · ${review} in review`, 'scanner', 'ok');
    return { backend, columns: merged.length, enforced, review, added, removed, durationMs };
  },

  /** Simulate an upstream DDL rename; the old catalog entry stays until a rescan. */
  async simulateDrift(): Promise<{ table: string; from: string; to: string; backend: string }> {
    await boot();
    await wait(readLatency());
    const table = 'contacts';
    if (dataset.hasRename(table)) throw new ApiError('SM-CAT-004', 'The schema has already drifted; rescan crm_mysql to reconcile.', 409);
    dataset.renameColumn(table, 'contact_phone', 'handset');
    appendAudit({ event_type: 'SCHEMA_DRIFT', principal: 'schema-watcher', requesting_role: 'ROLE_ADMIN', backend: 'crm_mysql', detail: 'Column crm_mysql.contacts.contact_phone renamed to handset (upstream DDL). New column is masked fail-closed until rescanned.' });
    activity('drift', 'Schema drift detected', 'contacts.contact_phone → handset. Unknown columns are masked fail-closed.', 'schema-watcher', 'warn');
    return { table, from: 'contact_phone', to: 'handset', backend: 'crm_mysql' };
  },

  async reviewQueue(): Promise<ReviewItem[]> {
    return read(() => [...st().records.values()].filter((r) => r.state === 'REVIEW').map((record) => ({ record, triage: triage(record) })), { catalog: true });
  },

  async decide(input: DecisionInput, actor: string): Promise<{ previous: ColumnRecord; next: ColumnRecord }> {
    await boot();
    await wait(readLatency());
    const s = st();
    const prev = s.records.get(input.columnId);
    if (!prev) throw new ApiError('SM-CAT-404', `Column ${input.columnId} is no longer in the catalog.`, 404);
    if (input.action === 'CLEAR' && input.reason.trim().length < 12) throw new ApiError('SM-REV-001', 'Clearing a column needs a justification of at least 12 characters.', 422);
    const from = prev.state;
    const next: ColumnRecord = { ...prev, history: [...prev.history] };
    let to: Decision['to'];
    switch (input.action) {
      case 'APPROVE':
        to = 'ENFORCED';
        next.tag = input.tag ?? prev.suggestedTag ?? 'PII_MEDIUM';
        break;
      case 'CLEAR':
        to = 'CLEAR';
        next.tag = null;
        break;
      case 'FORCE_TAG':
        to = 'OVERRIDDEN';
        next.tag = input.tag ?? 'PII_HIGH';
        next.override = { mode: 'TAG', tag: next.tag, justification: input.reason };
        break;
      case 'OVERRIDE':
        to = 'OVERRIDDEN';
        next.override = { mode: input.mode ?? 'TAG', ...(input.tag ? { tag: input.tag } : {}), justification: input.reason };
        next.tag = input.mode === 'CLEAR' ? null : (input.tag ?? prev.tag);
        break;
    }
    next.state = to;
    next.history.push({ at: nowStamp(), by: actor, action: input.action, from, to, reason: input.reason });
    s.records.set(next.id, next);
    emit('columns', 'review', 'overview');
    appendAudit({
      event_type: 'REVIEW_DECISION', principal: actor, requesting_role: 'ROLE_ADMIN', backend: prev.backend,
      detail: `${input.action} ${next.id}: ${from} → ${to}${next.tag ? ` (${next.tag})` : ''}. ${input.reason}`,
    });
    activity('review', `${input.action === 'FORCE_TAG' ? 'Force-tagged' : input.action === 'APPROVE' ? 'Approved' : input.action === 'CLEAR' ? 'Cleared' : 'Overrode'} ${next.id}`, input.reason, actor, input.action === 'CLEAR' || input.mode === 'CLEAR' ? 'warn' : 'ok');
    return { previous: prev, next };
  },

  async undoDecision(previous: ColumnRecord, actor: string): Promise<void> {
    await boot();
    await wait(readLatency() / 2);
    const s = st();
    const cur = s.records.get(previous.id);
    emit('columns', 'review', 'overview');
    s.records.set(previous.id, { ...previous, history: [...previous.history, { at: nowStamp(), by: actor, action: 'UNDO', from: cur?.state ?? null, to: previous.state, reason: 'Decision undone from toast' }] });
    appendAudit({ event_type: 'REVIEW_DECISION', principal: actor, requesting_role: 'ROLE_ADMIN', backend: previous.backend, detail: `UNDO ${previous.id}: restored ${previous.state}` });
    activity('review', `Undid decision on ${previous.id}`, `Restored ${previous.state}`, actor, 'info');
  },

  /* ---------- policy ---------- */
  async policy(): Promise<PolicyData> {
    return read(() => ({ text: st().policyText, policy: st().policy, version: st().policy.version, history: st().policyLog }));
  },

  async copilot(request: string): Promise<CopilotResult> {
    await boot();
    await wait(450 + latRng.float(0, 450));
    const { copilotDraft } = await yamlEngine();
    return copilotDraft(request, st().policyText);
  },

  /** Run the golden queries under the live and the proposed policy for every role and diff the masked output. */
  async goldenDiff(proposedText: string): Promise<GoldenDiffRow[]> {
    await boot();
    await wait(readLatency());
    const s = st();
    const { parsePolicy } = await yamlEngine();
    const proposed = parsePolicy(proposedText).policy;
    if (!proposed) throw new ApiError('SM-POL-001', 'The proposed policy does not validate.', 422);
    const rows: GoldenDiffRow[] = [];
    const tagInfo = makeTagInfo(s.records);
    for (const g of GOLDEN_QUERIES) {
      const run = (policy: Policy) => runPipeline({ sql: g.sql, dialect: 'postgresql', approach: 'views', policy, schema: schemaLookup, tagInfo, provider: dataset, vault: s.vault });
      const [a, b] = await Promise.all([run(s.policy), run(proposed)]);
      for (const role of ROLES) {
        const oa = a.outcomes[role];
        const ob = b.outcomes[role];
        const ma = oa.masked ?? [];
        const mb = ob.masked ?? [];
        let changed = 0;
        let total = 0;
        let first: [string, string] | null = null;
        const n = Math.max(ma.length, mb.length);
        for (let i = 0; i < n; i++) {
          const ra = ma[i] ?? [];
          const rb = mb[i] ?? [];
          for (let c = 0; c < Math.max(ra.length, rb.length); c++) {
            total++;
            if (String(ra[c] ?? '') !== String(rb[c] ?? '')) {
              changed++;
              first ??= [String(ra[c] ?? '∅'), String(rb[c] ?? '∅')];
            }
          }
        }
        const note = oa.violations.length || ob.violations.length ? `${oa.violations[0]?.code ?? 'ok'} → ${ob.violations[0]?.code ?? 'ok'}` : changed ? 'masking changed' : 'identical';
        rows.push({ queryId: g.id, title: g.title, role, changedCells: changed, totalCells: total, before: first?.[0] ?? '', after: first?.[1] ?? '', note });
      }
    }
    return rows;
  },

  async savePolicy(text: string, author: string, reason: string): Promise<{ version: number }> {
    await boot();
    await wait(readLatency());
    const s = st();
    const { parsePolicy, withVersion } = await yamlEngine();
    const v = parsePolicy(text);
    if (!v.policy) throw new ApiError('SM-POL-001', 'The policy has validation errors and cannot be saved.', 422);
    const version = s.policy.version + 1;
    const finalText = withVersion(text, version);
    const reparsed = parsePolicy(finalText);
    if (!reparsed.policy) throw new ApiError('SM-POL-001', 'The policy has validation errors and cannot be saved.', 422);
    s.policyText = finalText;
    s.policy = reparsed.policy;
    s.policyLog = [...s.policyLog, { version, at: nowStamp(), author, reason: reason || 'Policy edited in Policy Studio.' }];
    s.planCache = new Set();
    emit('policy', 'performance');
    s.bumpsLive++;
    s.lastBumpWall = Date.now();
    appendAudit({ event_type: 'POLICY_PUBLISH', principal: author, requesting_role: 'ROLE_ADMIN', detail: `policy_version ${version - 1} → ${version}. ${reason || 'Policy edited in Policy Studio.'} Plan cache invalidated.` });
    activity('policy', `Policy v${version} published`, `${reason || 'Policy edited in Policy Studio.'} Cache invalidated.`, author, 'info');
    return { version };
  },

  /* ---------- query ---------- */
  async runQuery(input: { sql: string; backend: string; role: Role }): Promise<QueryRunResult> {
    await boot();
    const s = st();
    await wait(latRng.float(80, 260));
    const principal = DEFAULT_PRINCIPAL[input.role];
    const dialect = dialectOf(input.backend);
    const finish = (violations: Violation[], pipeline: Awaited<ReturnType<typeof runPipeline>> | null, extra: { hash: string | null; stages: StageTimings | null; cacheHit: boolean; tables: string[]; columns: string[]; masks: { column: string; function: string }[]; rows: number; fatal?: Violation }): QueryRunResult => {
      const v = extra.fatal ?? violations[0] ?? null;
      const audit = appendAudit({
        event_type: 'QUERY', principal, requesting_role: input.role, backend: input.backend, query_hash: extra.hash,
        columns_accessed: extra.columns, masking_applied: extra.masks, execution_time_ms: extra.stages?.overhead ?? 0, rows_returned: extra.rows,
        stages: extra.stages ? { parse: extra.stages.parse, policy: extra.stages.policy, mutation: extra.stages.mutation, render: extra.stages.render, audit: extra.stages.audit } : null,
        outcome: v ? 'DENIED' : 'ALLOWED', code: v?.code ?? null, detail: v ? v.message : `${extra.tables.join(', ')} · ${extra.rows} row(s) · cache ${extra.cacheHit ? 'hit' : 'miss'}`,
      });
      activity('query', v ? `Query rejected (${v.code})` : 'Query executed', `${input.role.replace('ROLE_', '')} · ${extra.tables.join(', ') || input.backend}`, principal, v ? 'warn' : 'info');
      return { pipeline, violations, role: input.role, stages: extra.stages, cacheHit: extra.cacheHit, audit, tables: extra.tables, backend: input.backend, fatal: extra.fatal ?? null };
    };

    if (getChaos().auditFull) {
      const fatal: Violation = { code: 'SM-AUDIT-001', message: 'The audit queue is full. SmartMask fails closed: no query runs without a durable audit record.' };
      return { pipeline: null, violations: [fatal], role: input.role, stages: null, cacheHit: false, audit: s.audit[s.audit.length - 1] as AuditEvent, tables: [], backend: input.backend, fatal };
    }

    try {
      const pipeline = await runPipeline({
        sql: input.sql, dialect, approach: approachOf(input.backend), policy: s.policy, schema: schemaLookup,
        tagInfo: makeTagInfo(s.records), provider: dataset, vault: s.vault,
      });
      const outcome = pipeline.outcomes[input.role];
      const hash = sha256HexSync(pipeline.normalizedSql);
      const key = `${hash}|${input.role}|${s.policy.version}`;
      const cacheHit = s.planCache.has(key);
      s.planCache.add(key);
      const base = pipeline.stages[input.role];
      const stages: StageTimings = cacheHit
        ? (() => {
            const parse = Math.round(base.parse * 0.3 * 1000) / 1000;
            const mutation = Math.round(base.mutation * 0.35 * 1000) / 1000;
            return { ...base, parse, mutation, overhead: Math.round((parse + base.policy + mutation + base.render + base.audit) * 1000) / 1000 };
          })()
        : base;
      const tables = outcome.analysis?.tables ?? [];
      const result = finish(outcome.violations, pipeline, {
        hash, stages, cacheHit, tables, columns: outcome.analysis?.referenced ?? [], masks: (outcome.analysis?.masks ?? []).map((m) => ({ column: m.column, function: m.fn })), rows: outcome.masked?.length ?? 0,
      });
      recordBatch(input.role, principal, hash, tables.length ? tables : [...new Set(pipelineTables(pipeline))]).catch(() => undefined);
      return result;
    } catch (e) {
      if (e instanceof EngineError) {
        const code = e.code === 'SM-CAT-002' ? 'SM-CAT-002' : 'SM-PARSE-001';
        const v: Violation = { code, message: e.message };
        return finish([v], null, { hash: null, stages: null, cacheHit: false, tables: [], columns: [], masks: [], rows: 0, fatal: v });
      }
      throw e;
    }
  },

  /* ---------- verification ---------- */
  async verification(): Promise<{ baseline: { table: string; backend: string; rows: number; sha: string }[]; history: VerificationBatch[] }> {
    await boot();
    await wait(readLatency());
    await ensureBaseline();
    const s = st();
    return {
      baseline: TABLES.map((t) => ({ table: t.name, backend: t.backend, rows: t.rows, sha: s.baseline.get(t.name) as string })),
      history: s.verification,
    };
  },

  async runVerificationBatch(actor: string): Promise<VerificationBatch> {
    await boot();
    await ensureBaseline();
    const s = st();
    const sqls = GOLDEN_QUERIES.map((g) => g.sql);
    for (const sql of sqls) {
      await runPipeline({ sql, dialect: 'postgresql', approach: 'views', policy: s.policy, schema: schemaLookup, tagInfo: makeTagInfo(s.records), provider: dataset, vault: s.vault });
      await tick();
    }
    return recordBatch('ROLE_ADMIN', actor, 'golden-batch', TABLES.map((t) => t.name), `Golden batch (${sqls.length} queries × 3 roles)`);
  },

  /* ---------- audit ---------- */
  async audit(): Promise<AuditData> {
    return read(() => ({ events: st().audit, verdict: st().verdict, tamperedAt: st().tamper?.index ?? null }));
  },

  async verifyChain(onProgress?: (done: number) => void): Promise<ChainVerdict & { at: string }> {
    await boot();
    await wait(readLatency());
    const s = st();
    const v = await verifyChain(s.audit, onProgress);
    s.verdict = { ...v, at: nowStamp() };
    activity('audit', v.ok ? 'Audit chain verified' : 'Audit chain BROKEN', v.ok ? `${v.checked.toLocaleString()} events, no breaks` : `First inconsistency at event #${(s.audit[v.brokenAt ?? 0] as AuditEvent).id} (${v.fault})`, 'verifier', v.ok ? 'ok' : 'bad');
    return s.verdict;
  },

  async tamperAudit(): Promise<{ index: number; id: number }> {
    await boot();
    await wait(readLatency() / 2);
    const s = st();
    if (s.tamper) return { index: s.tamper.index, id: (s.audit[s.tamper.index] as AuditEvent).id };
    const index = Math.floor(s.audit.length * 0.62);
    s.tamper = { index, original: s.audit[index] as AuditEvent };
    s.audit = tamperEvents(s.audit, index);
    s.verdict = null;
    emit('audit');
    activity('audit', 'Tamper simulation: event corrupted', `Event #${(s.audit[index] as AuditEvent).id} was modified without re-sealing`, 'tamper-test', 'warn');
    return { index, id: (s.audit[index] as AuditEvent).id };
  },

  async restoreAudit(): Promise<void> {
    await boot();
    await wait(readLatency() / 2);
    const s = st();
    if (!s.tamper) return;
    const { index, original } = s.tamper;
    s.audit = s.audit.map((e, i) => (i === index ? original : e));
    s.tamper = null;
    emit('audit');
    s.verdict = { ...(await verifyChain(s.audit)), at: nowStamp() };
    activity('audit', 'Audit event restored from backup', `Event #${original.id} restored; chain verified`, 'verifier', 'ok');
  },

  /* ---------- performance, anomalies, principals ---------- */
  async performance(): Promise<PerformanceData> {
    return read(() => {
      const s = st();
      const hours = s.telemetry.hours;
      const key = ['parse', 'policy', 'mutation', 'render', 'audit'] as const;
      const queryEvents = s.audit.filter((e) => e.event_type === 'QUERY' && e.stages);
      const stageMeans = Object.fromEntries(key.map((k) => [k, mean(queryEvents.map((e) => (e.stages as NonNullable<AuditEvent['stages']>)[k]))])) as Record<(typeof key)[number], number>;
      const ms = queryEvents.map((e) => e.execution_time_ms).sort((a, b) => a - b);
      const dayStride = 60;
      const cacheSeries: { t: number; ratio: number }[] = [];
      for (let m = 0; m < s.telemetry.minutes; m += dayStride) {
        let acc = 0;
        for (let k = 0; k < dayStride; k++) acc += s.telemetry.cacheHit[m + k] as number;
        cacheSeries.push({ t: s.telemetry.start + m * 60_000, ratio: acc / dayStride });
      }
      return {
        hours: hours.map((h) => ({ start: h.start, p50: h.p50, p95: h.p95, p99: h.p99, total: h.total, stages: h.stages })),
        stageMeans,
        p50: percentile(ms, 50),
        p95: percentile(ms, 95),
        p99: percentile(ms, 99),
        cacheSeries,
        cacheAvg: mean([...s.telemetry.cacheHit]),
        policyBumps: s.telemetry.policyBumps.map((m) => s.telemetry.start + m * 60_000),
        lastBumpWall: s.lastBumpWall,
        bumpsLive: s.bumpsLive,
      };
    });
  },

  async anomalies(): Promise<{ alerts: AnomalyAlert[]; events: Record<string, AuditEvent[]> }> {
    return read(() => {
      const s = st();
      const byId = new Map(s.audit.map((e) => [e.id, e]));
      const events: Record<string, AuditEvent[]> = {};
      for (const a of s.alerts) events[a.id] = a.eventIds.slice(0, 40).map((id) => byId.get(id)).filter((e): e is AuditEvent => !!e);
      return { alerts: s.alerts, events };
    });
  },

  async actOnAlert(id: string, status: 'acknowledged' | 'dismissed' | 'open', actor: string): Promise<AnomalyAlert> {
    await boot();
    await wait(readLatency() / 2);
    const s = st();
    const a = s.alerts.find((x) => x.id === id);
    if (!a) throw new ApiError('SM-ANOM-404', `Alert ${id} not found.`, 404);
    const prev = a.status;
    s.alerts = s.alerts.map((x) => (x.id === id ? { ...x, status } : x));
    emit('anomalies');
    if (status !== 'open') {
      appendAudit({ event_type: 'ALERT_ACTION', principal: actor, requesting_role: 'ROLE_ADMIN', detail: `${status.toUpperCase()} alert ${id} for ${a.principal} (was ${prev})` });
      activity('alert', `Alert ${id} ${status}`, `${a.principal}: ${a.summary}`, actor, 'info');
    }
    return { ...a, status };
  },

  async principals() {
    return read(() => PRINCIPALS);
  },

  async logRoleChange(from: Role, to: Role): Promise<void> {
    await boot();
    appendAudit({ event_type: 'ROLE_SWITCH', principal: DEFAULT_PRINCIPAL[to], requesting_role: to, detail: `Console role switched ${from.replace('ROLE_', '')} → ${to.replace('ROLE_', '')}` });
    activity('role', `Role switched to ${to.replace('ROLE_', '')}`, `${from.replace('ROLE_', '')} → ${to.replace('ROLE_', '')}`, DEFAULT_PRINCIPAL[to], 'info');
  },

  async logExport(name: string, format: string, actor: string): Promise<void> {
    await boot();
    appendAudit({ event_type: 'EXPORT', principal: actor, requesting_role: 'ROLE_ADMIN', detail: `Exported ${name} as ${format}` });
    activity('export', `Report exported: ${name}`, format, actor, 'info');
  },
};

/** Live cache state for the Performance view. */
export function liveCache(): { sinceBump: number | null; ratio: number } {
  const s = state;
  if (!s || s.lastBumpWall === null) return { sinceBump: null, ratio: cacheRatio(null) };
  const since = ((Date.now() - s.lastBumpWall) / 1000) * 8;
  return { sinceBump: since, ratio: cacheRatio(since) };
}

export const serverSnapshot = (): { auditCount: number; tamperIndex: number | null } => ({ auditCount: state?.audit.length ?? 0, tamperIndex: state?.tamper?.index ?? null });
export const auditTarget = AUDIT_TOTAL;

function pipelineTables(p: Awaited<ReturnType<typeof runPipeline>>): string[] {
  const a = p.outcomes.ROLE_ADMIN.analysis;
  return a?.tables ?? [];
}

async function ensureBaseline(): Promise<void> {
  const s = st();
  if (s.baseline.size === TABLES.length) return;
  for (const t of TABLES) {
    if (!s.baseline.has(t.name)) s.baseline.set(t.name, await dataset.checksum(t.name));
    await tick();
  }
  // Seed a believable history of earlier verified batches.
  if (!s.verification.length) {
    const labels = ['Nightly verification', 'Post-scan verification', 'Policy v7 smoke test', 'Policy v6 smoke test', 'Weekly integrity sweep'];
    s.verification = labels.map((label, i) => ({
      id: `vb-seed-${i}`,
      at: iso(DEMO_NOW - (3 + i * 22) * 3_600_000),
      label,
      actor: i === 0 ? 'scheduler' : 'o.taylor',
      tables: TABLES.slice(0, 4 + (i % 3) * 3).map((t) => ({ table: t.name, before: s.baseline.get(t.name) as string, after: s.baseline.get(t.name) as string })),
      match: true,
    }));
  }
}

async function recordBatch(role: Role, actor: string, label: string, tables: string[], title?: string): Promise<VerificationBatch> {
  const s = st();
  await ensureBaseline();
  const uniq = [...new Set(tables)].filter((t) => tableByName(t));
  const rows = [];
  for (const t of uniq) {
    const before = s.baseline.get(t) as string;
    const after = await dataset.checksum(t);
    rows.push({ table: t, before, after });
  }
  const batch: VerificationBatch = {
    id: `vb-${++seq}`, at: nowStamp(), label: title ?? `Query ${label.slice(0, 8)} · ${role.replace('ROLE_', '')}`, actor,
    tables: rows, match: rows.every((r) => r.before === r.after),
  };
  s.verification = [batch, ...s.verification].slice(0, 80);
  emit('verification');
  return batch;
}

