import { sealEvent, GENESIS_HASH, type AuditBody, type AuditEvent } from '../engine/audit';
import { sha256HexSync } from '../engine/hash';
import type { Policy } from '../engine/policy';
import { simulateStages } from '../engine/pipeline';
import { createRng, type Rng } from '../engine/prng';
import { analyzeQuery, type AnalyzeEnv } from '../engine/sql/analyze';
import { executeQuery } from '../engine/sql/exec';
import { formatQuery } from '../engine/sql/format';
import { parseSql } from '../engine/sql/parser';
import type { Role } from '../engine/types';
import { dataset } from './dataset';
import { POLICY_HISTORY, principalsOf } from './principals';
import { DAY, DEMO_NOW } from './pool';
import { approachOf, dialectOf } from './runtime';

export interface QueryTemplate {
  id: string;
  backend: string;
  sql: string;
  /** Relative weight per role. */
  weights: Record<Role, number>;
}

const w = (admin: number, support: number, analyst: number): Record<Role, number> => ({
  ROLE_ADMIN: admin,
  ROLE_SUPPORT: support,
  ROLE_ANALYST: analyst,
});

export const TEMPLATES: QueryTemplate[] = [
  { id: 't01', backend: 'core_pg', sql: 'SELECT customer_id, full_name, email, phone FROM customers WHERE customer_id = 1042', weights: w(4, 30, 0) },
  { id: 't02', backend: 'core_pg', sql: 'SELECT c.card_no, a.balance FROM cards c JOIN accounts a ON a.account_id = c.account_id WHERE c.customer_id = 1', weights: w(3, 22, 2) },
  { id: 't03', backend: 'core_pg', sql: 'SELECT segment, COUNT(*) AS customers FROM customers GROUP BY segment', weights: w(2, 3, 16) },
  { id: 't04', backend: 'core_pg', sql: "SELECT card_no, amount FROM transactions WHERE status = 'DECLINED' LIMIT 50", weights: w(3, 9, 12) },
  { id: 't05', backend: 'core_pg', sql: 'SELECT c.ssn, COUNT(*) AS loans FROM customers c JOIN loans l ON l.applicant_ssn = c.ssn GROUP BY c.ssn LIMIT 100', weights: w(1, 0, 14) },
  { id: 't06', backend: 'core_pg', sql: "SELECT email FROM customers WHERE city = 'Mumbai' LIMIT 25", weights: w(1, 12, 4) },
  { id: 't07', backend: 'crm_mysql', sql: "SELECT ticket_id, subject, status FROM support_tickets WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 50", weights: w(1, 18, 3) },
  { id: 't08', backend: 'crm_mysql', sql: "SELECT contact_id, contact_email, contact_phone FROM contacts WHERE preferred_channel = 'SMS' LIMIT 40", weights: w(1, 10, 5) },
  { id: 't09', backend: 'ledger_lite', sql: "SELECT settlement_id, order_ref, amount FROM settlements WHERE status = 'HELD'", weights: w(5, 1, 6) },
  { id: 't10', backend: 'ledger_lite', sql: 'SELECT ledger_account, closing_balance FROM ledger_accounts ORDER BY ledger_account LIMIT 30', weights: w(4, 0, 9) },
  { id: 't11', backend: 'core_pg', sql: 'SELECT merchant_name, SUM(amount) AS total FROM transactions GROUP BY merchant_name', weights: w(3, 1, 9) },
  { id: 't12', backend: 'core_pg', sql: "SELECT customer_id, full_name FROM customers WHERE ssn = '123-45-6789'", weights: w(1, 2, 2) },
  { id: 't13', backend: 'core_pg', sql: "WITH big AS (SELECT account_id, balance FROM accounts WHERE status = 'ACTIVE') SELECT * FROM big LIMIT 20", weights: w(2, 2, 6) },
  { id: 't14', backend: 'core_pg', sql: 'SELECT t.txn_id, t.amount, c.cardholder_name FROM transactions t JOIN cards c ON c.card_no = t.card_no LIMIT 50', weights: w(1, 0, 10) },
  { id: 't15', backend: 'core_pg', sql: "SELECT loan_id, principal, outstanding_balance FROM loans WHERE status = 'ARREARS' LIMIT 30", weights: w(2, 8, 8) },
  { id: 't16', backend: 'crm_mysql', sql: 'SELECT agent_id, full_name, team FROM agents', weights: w(3, 5, 1) },
  { id: 't17', backend: 'core_pg', sql: "SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM loans WHERE status = 'ARREARS')", weights: w(1, 4, 7) },
];

export interface SeedDeps {
  policy: Policy;
  schema: AnalyzeEnv['schema'];
  tagInfo: AnalyzeEnv['tagInfo'];
}

interface Resolved {
  denied: string | null;
  deniedMsg: string;
  columns: string[];
  masks: { column: string; function: string }[];
  rows: number;
  hash: string;
  complexity: number;
  tables: string[];
}

async function resolveTemplate(t: { backend: string; sql: string }, role: Role, deps: SeedDeps): Promise<Resolved> {
  const dialect = dialectOf(t.backend);
  const ast = parseSql(t.sql);
  const normalized = formatQuery(ast, { dialect, stripLiterals: true });
  const hash = sha256HexSync(normalized);
  const env: AnalyzeEnv = { role, dialect, approach: approachOf(t.backend), policy: deps.policy, schema: deps.schema, tagInfo: deps.tagInfo };
  const a = analyzeQuery(ast, env);
  const complexity = Math.min(1, normalized.length / 700);
  if (a.violations.length) {
    const v = a.violations[0] as NonNullable<(typeof a.violations)[number]>;
    return { denied: v.code, deniedMsg: v.message, columns: a.referenced, masks: [], rows: 0, hash, complexity, tables: a.tables };
  }
  let rows = 0;
  try {
    rows = executeQuery(ast, dataset).rows.length;
  } catch {
    rows = 0;
  }
  return { denied: null, deniedMsg: '', columns: a.referenced, masks: a.masks.map((m) => ({ column: m.column, function: m.fn })), rows, hash, complexity, tables: a.tables };
}

const LOCAL_OFFSET_H = 5.5;
function hourWeight(ms: number, role: Role): number {
  const d = new Date(ms + LOCAL_OFFSET_H * 3_600_000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dow = d.getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.22 : 1;
  const peak = role === 'ROLE_ANALYST' ? [11, 17] : [9, 18];
  let base = 0.03;
  if (h >= peak[0]! && h < peak[1]!) base = 1;
  else if (h >= peak[0]! - 2 && h < peak[1]! + 3) base = 0.32;
  if (role === 'ROLE_ANALYST' && h >= 12 && h < 15) base *= 1.25;
  if (role === 'ROLE_SUPPORT' && h >= 10 && h < 12) base *= 1.2;
  return base * weekend;
}

function sampleTimes(n: number, role: Role, start: number, minutes: number, rng: Rng): number[] {
  const cdf = new Float64Array(minutes);
  let acc = 0;
  for (let m = 0; m < minutes; m++) {
    acc += hourWeight(start + m * 60_000, role);
    cdf[m] = acc;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const target = rng.next() * acc;
    let lo = 0;
    let hi = minutes - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] as number) < target) lo = mid + 1;
      else hi = mid;
    }
    out.push(start + lo * 60_000 + rng.int(0, 59_999));
  }
  return out;
}

export const AUDIT_TOTAL = 8000;
export const WINDOW_MINUTES = 14 * 24 * 60;
export const WINDOW_START = DEMO_NOW - 14 * DAY;

type Draft = Omit<AuditBody, 'id' | 'policy_version'> & { policy_version?: number };

const policyVersionAt = (ms: number): number => {
  let v = 1;
  for (const p of POLICY_HISTORY) if (Date.parse(`${p.at.replace(' ', 'T')}Z`) <= ms) v = p.version;
  return v;
};

export interface InjectedAnomaly {
  principal: string;
  startMs: number;
  endMs: number;
  title: string;
}

export const INJECTED: InjectedAnomaly[] = [
  { principal: 't.chikwanha', startMs: Date.UTC(2026, 9, 12, 2, 14), endMs: Date.UTC(2026, 9, 12, 2, 24), title: 'Denied probe burst followed by a sweep of eleven tagged columns' },
  { principal: 'a.kulkarni', startMs: Date.UTC(2026, 9, 10, 15, 0), endMs: Date.UTC(2026, 9, 10, 16, 0), title: 'Weekend bulk read of identifier columns' },
  { principal: 'm.desai', startMs: Date.UTC(2026, 9, 7, 22, 40), endMs: Date.UTC(2026, 9, 7, 23, 30), title: 'Repeated cross-table token joins on SSN (re-identification pattern)' },
];

const SWEEP: { sql: string; backend: string }[] = [
  { backend: 'core_pg', sql: 'SELECT ssn FROM customers LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT aadhaar_no FROM customers LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT email FROM customers LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT phone FROM customers LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT dob FROM customers LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT address_line FROM customers LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT card_no FROM cards LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT account_no FROM accounts LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT iban FROM accounts LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT balance FROM accounts LIMIT 500' },
  { backend: 'core_pg', sql: 'SELECT principal FROM loans LIMIT 500' },
];

/** Build the 8,000-event hash-chained audit log. Every event's columns and masks come from the real analyzer. */
export async function buildSeedAudit(deps: SeedDeps): Promise<AuditEvent[]> {
  const rng = createRng('audit-seed');
  const cache = new Map<string, Resolved>();
  const resolve = async (t: { backend: string; sql: string }, role: Role): Promise<Resolved> => {
    const key = `${t.sql}|${role}`;
    let r = cache.get(key);
    if (!r) {
      r = await resolveTemplate(t, role, deps);
      cache.set(key, r);
    }
    return r;
  };

  const drafts: Draft[] = [];
  const push = async (
    t: { backend: string; sql: string },
    role: Role,
    principal: string,
    ts: number,
    detail?: string,
    rowsOverride?: number,
  ): Promise<void> => {
    const r = await resolve(t, role);
    const st = simulateStages(rng, r.complexity, 0);
    const stages = { parse: st.parse, policy: st.policy, mutation: r.denied ? 0 : st.mutation, render: r.denied ? 0 : st.render, audit: st.audit };
    const overhead = Math.round((stages.parse + stages.policy + stages.mutation + stages.render + stages.audit) * 1000) / 1000;
    drafts.push({
      event_type: 'QUERY',
      timestamp: new Date(ts).toISOString(),
      principal,
      requesting_role: role,
      backend: t.backend,
      query_hash: r.hash,
      columns_accessed: r.columns,
      masking_applied: r.masks,
      execution_time_ms: overhead,
      rows_returned: rowsOverride ?? r.rows,
      stages,
      outcome: r.denied ? 'DENIED' : 'ALLOWED',
      code: r.denied,
      detail: detail ?? (r.denied ? r.deniedMsg : `${r.tables.join(', ')} · ${r.rows} row(s)`),
    });
  };

  // Injected anomalies first, so the baseline fills the remainder up to exactly 8,000.
  const probe = INJECTED[0] as InjectedAnomaly;
  for (let i = 0; i < 40; i++) {
    await push(
      { backend: 'core_pg', sql: `SELECT customer_id FROM cards WHERE card_no = '4111-1111-1111-${String(1000 + i * 7).slice(0, 4)}'` },
      'ROLE_ANALYST', probe.principal, probe.startMs + i * 8_000 + rng.int(0, 3000), 'Literal predicate on tagged column card_no (probe)',
    );
  }
  for (let i = 0; i < SWEEP.length; i++) {
    await push(SWEEP[i] as { backend: string; sql: string }, 'ROLE_ANALYST', probe.principal, probe.startMs + 6 * 60_000 + i * 20_000 + rng.int(0, 5000), 'Column sweep after denied probes', 500);
  }
  const bulk = INJECTED[1] as InjectedAnomaly;
  for (let i = 0; i < 120; i++) {
    await push({ backend: 'core_pg', sql: 'SELECT customer_id, ssn, aadhaar_no FROM kyc_documents LIMIT 500' }, 'ROLE_SUPPORT', bulk.principal, bulk.startMs + i * 30_000 + rng.int(0, 9000), 'Weekend bulk read of identifier columns', 500);
  }
  const reid = INJECTED[2] as InjectedAnomaly;
  for (let i = 0; i < 70; i++) {
    await push(
      { backend: 'core_pg', sql: 'SELECT c.ssn, k.doc_type, l.principal FROM customers c JOIN kyc_documents k ON k.ssn = c.ssn JOIN loans l ON l.applicant_ssn = c.ssn LIMIT 400' },
      'ROLE_ANALYST', reid.principal, reid.startMs + i * 42_000 + rng.int(0, 12_000), 'Cross-table token join on ssn', 400,
    );
  }

  const remaining = AUDIT_TOTAL - drafts.length;
  const shares: [Role, number][] = [['ROLE_SUPPORT', 0.55], ['ROLE_ANALYST', 0.38], ['ROLE_ADMIN', 0.07]];
  for (const [role, share] of shares) {
    const n = role === 'ROLE_ADMIN' ? remaining - Math.round(remaining * 0.55) - Math.round(remaining * 0.38) : Math.round(remaining * share);
    const times = sampleTimes(n, role, WINDOW_START, WINDOW_MINUTES, rng);
    const pool = TEMPLATES.map((t) => [t, t.weights[role]] as const).filter(([, wt]) => wt > 0);
    const people = principalsOf(role);
    for (const ts of times) {
      const t = rng.weighted(pool);
      const person = rng.weighted(people.map((p) => [p, ['t.chikwanha', 'a.kulkarni', 'm.desai'].includes(p.id) ? 0.6 : 1] as const));
      await push(t, role, person.id, ts);
    }
  }

  drafts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const events: AuditEvent[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i] as Draft;
    const e = sealEvent({ ...d, id: i + 1, policy_version: policyVersionAt(Date.parse(d.timestamp)) } as AuditBody, prev);
    events.push(e);
    prev = e.event_hash;
  }
  return events;
}

