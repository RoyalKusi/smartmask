import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  sealEvent,
  tamper,
  verifyChain,
  type AuditBody,
  type AuditEvent,
} from '../../src/shared/engine/audit';

const body = (i: number): AuditBody => ({
  id: i,
  event_type: 'QUERY',
  timestamp: `2026-10-15T12:00:${String(i).padStart(2, '0')}.000Z`,
  principal: 'p.iyer',
  requesting_role: 'ROLE_SUPPORT',
  backend: 'core_pg',
  query_hash: `h${i}`,
  columns_accessed: ['cards.card_no'],
  masking_applied: [{ column: 'cards.card_no', function: 'PARTIAL_KEEP' }],
  execution_time_ms: 1.5,
  rows_returned: 1,
  stages: null,
  outcome: 'ALLOWED',
  code: null,
  detail: 'x',
  policy_version: 7,
});

function chain(n: number): AuditEvent[] {
  const out: AuditEvent[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const e = sealEvent(body(i), prev);
    out.push(e);
    prev = e.event_hash;
  }
  return out;
}

describe('hash-chained audit', () => {
  it('a clean chain verifies', async () => {
    expect(await verifyChain(chain(50))).toMatchObject({ ok: true, checked: 50, brokenAt: null });
  });
  it('each event commits to the previous one', () => {
    const c = chain(3);
    expect(c[0]!.prev_hash).toBe(GENESIS_HASH);
    expect(c[1]!.prev_hash).toBe(c[0]!.event_hash);
    expect(c[2]!.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('tampering with one event is pinpointed', async () => {
    const t = tamper(chain(40), 17);
    const v = await verifyChain(t);
    expect(v).toMatchObject({ ok: false, brokenAt: 17, fault: 'hash_mismatch' });
  });
  it('re-sealing a tampered event still breaks the link to its successor', async () => {
    const c = chain(10);
    const forged = sealEvent({ ...body(5), execution_time_ms: 9.99 }, c[3]!.event_hash);
    const v = await verifyChain(c.map((e, i) => (i === 4 ? forged : e)));
    expect(v).toMatchObject({ ok: false, brokenAt: 5, fault: 'link_mismatch' });
  });
  it('deleting an event breaks the link', async () => {
    const c = chain(10);
    expect((await verifyChain([...c.slice(0, 4), ...c.slice(5)])).brokenAt).toBe(4);
  });
});
