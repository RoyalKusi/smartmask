import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dataset } from '../../src/shared/data/dataset';
import { TABLES } from '../../src/shared/data/schema';
import { simulateStages, STAGE_BUDGET_MS, P99_CEILING_MS } from '../../src/shared/engine/pipeline';
import { createRng } from '../../src/shared/engine/prng';
import { ROLES } from '../../src/shared/engine/types';
import { catalogMap, run } from './helpers';

describe('end-to-end pipeline, golden per role', () => {
  const sql = 'SELECT c.card_no, a.balance FROM cards c JOIN accounts a ON a.account_id = c.account_id WHERE c.customer_id = 1';
  it('Admin sees plaintext, Support partial + bucket, Analyst token + [REDACTED]', async () => {
    const r = await run(sql);
    expect(r.outcomes.ROLE_ADMIN.masked![0]).toEqual(['4111-1111-1111-1111', '128450.00']);
    expect(r.outcomes.ROLE_SUPPORT.masked![0]).toEqual(['4111-XXXX-XXXX-1111', '100,000–149,999']);
    const an = r.outcomes.ROLE_ANALYST.masked![0]!;
    expect(an[0]).toMatch(/^tok_[0-9a-f]{24}$/);
    expect(an[1]).toBe('[REDACTED]');
    expect(r.raw.rows[0]).toEqual(['4111-1111-1111-1111', '128450.00']);
  });
  it('equal inputs give equal tokens so cross-table joins visibly work', async () => {
    const r = await run('SELECT c.ssn, l.principal FROM customers c JOIN loans l ON l.applicant_ssn = c.ssn LIMIT 30');
    const m = r.outcomes.ROLE_ANALYST.masked!;
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((row) => /^tok_[0-9a-f]{24}$/.test(String(row[0])))).toBe(true);
    const joined = await run('SELECT c.ssn, k.ssn AS kyc_ssn FROM customers c JOIN kyc_documents k ON k.customer_id = c.customer_id LIMIT 30');
    for (const row of joined.outcomes.ROLE_ANALYST.masked!) expect(row[0]).toBe(row[1]);
  });
  it('rejects tagged literal predicates for Support/Analyst but runs for Admin', async () => {
    const r = await run("SELECT customer_id FROM cards WHERE card_no = '4111-1111-1111-1111'");
    expect(r.outcomes.ROLE_ADMIN.violations).toEqual([]);
    expect(r.outcomes.ROLE_ADMIN.masked).toHaveLength(1);
    expect(r.outcomes.ROLE_SUPPORT.violations[0]!.code).toBe('SM-PRED-001');
    expect(r.outcomes.ROLE_ANALYST.masked).toBeNull();
  });
  it('executes aggregates, CTEs and subqueries over the base tables', async () => {
    const agg = await run('SELECT segment, COUNT(*) AS n FROM customers GROUP BY segment ORDER BY segment');
    expect(agg.raw.rows.reduce((s, r) => s + Number(r[1]), 0)).toBe(5000);
    const sub = await run("SELECT customer_id FROM customers WHERE customer_id IN (SELECT customer_id FROM loans WHERE status = 'ARREARS')");
    expect(sub.rowCount).toBeGreaterThan(0);
    const cte = await run("WITH big AS (SELECT account_id, balance FROM accounts WHERE status = 'ACTIVE') SELECT * FROM big LIMIT 5");
    expect(cte.raw.rows).toHaveLength(5);
  });
  it('base tables are byte-identical before and after a batch of queries', async () => {
    const before = await dataset.checksum('cards');
    await run('SELECT * FROM cards LIMIT 10');
    await run('SELECT card_no FROM cards');
    expect(await dataset.checksum('cards')).toBe(before);
  });
});

describe('simulated overhead', () => {
  it('stays under the 5.0 ms ceiling, spikes stay <= 4.6, and typical is within the 4.0 ms budget', () => {
    const rng = createRng('overhead');
    let spikes = 0;
    let overBudget = 0;
    for (let i = 0; i < 20000; i++) {
      const t = simulateStages(rng, rng.next());
      expect(t.overhead).toBeLessThan(P99_CEILING_MS);
      expect(t.overhead).toBeLessThanOrEqual(4.61);
      if (t.overhead > STAGE_BUDGET_MS) overBudget++;
      if (t.overhead > 4.2) spikes++;
    }
    expect(overBudget / 20000).toBeLessThan(0.02);
    expect(spikes).toBeGreaterThan(0);
  });
});

describe('property: no raw tagged value reaches non-Admin output', () => {
  const tables = TABLES.filter((t) => t.rows > 0);
  it('for random projections of random tables', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: tables.length - 1 }),
        fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 25 }),
        async (ti, colIdx, limit) => {
          const t = tables[ti]!;
          const cols = [...new Set(colIdx.map((i) => t.columns[i % t.columns.length]!.name))];
          const r = await run(`SELECT ${cols.join(', ')} FROM ${t.name} LIMIT ${limit}`, t.backend);
          for (const role of ['ROLE_SUPPORT', 'ROLE_ANALYST'] as const) {
            const o = r.outcomes[role];
            expect(o.violations).toEqual([]);
            const analysis = o.analysis!;
            analysis.outCols.forEach((oc, ci) => {
              const rec = catalogMap.get(oc.sources[0]!);
              const masked = rec && (rec.state === 'ENFORCED' || rec.state === 'ENFORCED_ML' || rec.state === 'REVIEW');
              if (!masked) return;
              o.masked!.forEach((row, ri) => {
                const raw = r.raw.rows[ri]![ci];
                const out = row[ci];
                if (raw === null) return expect(out).toBeNull();
                expect(out).not.toBe(raw);
                if (String(raw).length >= 8) expect(String(out)).not.toContain(String(raw));
              });
            });
          }
        },
      ),
      { numRuns: 60 },
    );
  });
  it('Admin output equals the base-table result', async () => {
    for (const role of ROLES) expect(role).toBeTruthy();
    const r = await run('SELECT customer_id, email FROM customers LIMIT 20');
    expect(r.outcomes.ROLE_ADMIN.masked).toEqual(r.raw.rows);
  });
});
