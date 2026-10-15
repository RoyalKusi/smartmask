import { describe, expect, it } from 'vitest';
import { AUDIT_TOTAL, INJECTED, buildSeedAudit } from '../../src/shared/data/auditSeed';
import { buildAnomalies } from '../../src/shared/data/anomalies';
import { buildTelemetry } from '../../src/shared/data/telemetry';
import { verifyChain } from '../../src/shared/engine/audit';
import { DEFAULT_POLICY } from '../../src/shared/engine/defaultPolicy';
import { schemaLookup } from '../../src/shared/data/runtime';
import { catalog, catalogMap, tagInfo } from './helpers';

describe('seeded audit log, telemetry and anomalies', async () => {
  const events = await buildSeedAudit({ policy: DEFAULT_POLICY, schema: schemaLookup, tagInfo });
  it('has 8,000 events with an intact SHA-256 chain, ordered by time', async () => {
    expect(events).toHaveLength(AUDIT_TOTAL);
    expect((await verifyChain(events)).ok).toBe(true);
    for (let i = 1; i < events.length; i++)
      expect(events[i]!.timestamp >= events[i - 1]!.timestamp).toBe(true);
    expect(events[0]).toHaveProperty('query_hash');
    expect(events[0]).toHaveProperty('requesting_role');
    expect(events[0]).toHaveProperty('columns_accessed');
    expect(events[0]).toHaveProperty('masking_applied');
    expect(events[0]).toHaveProperty('execution_time_ms');
  });
  it('is reproducible', async () => {
    const again = await buildSeedAudit({ policy: DEFAULT_POLICY, schema: schemaLookup, tagInfo });
    expect(again[4000]!.event_hash).toBe(events[4000]!.event_hash);
  });
  it('contains the injected probe: 40 denied card_no probes by an Analyst, then an eleven-column sweep', () => {
    const probe = events.filter(
      (e) => e.principal === INJECTED[0]!.principal && e.timestamp.startsWith('2026-10-12T02:'),
    );
    expect(probe.filter((e) => e.code === 'SM-PRED-001')).toHaveLength(40);
    expect(probe.filter((e) => e.outcome === 'ALLOWED' && e.detail.includes('sweep'))).toHaveLength(11);
  });
  it('overhead never exceeds the 5.0 ms ceiling and spikes reach about 4.6 ms', () => {
    const ms = events.map((e) => e.execution_time_ms);
    expect(Math.max(...ms)).toBeLessThan(5.0);
    expect(Math.max(...ms)).toBeGreaterThan(4.2);
  });
  it('per-minute telemetry covers 14 days with a cache ratio around 92% that dips after policy bumps', () => {
    const t = buildTelemetry(events);
    expect(t.minutes).toBe(14 * 24 * 60);
    const mean = [...t.cacheHit].reduce((a, b) => a + b, 0) / t.cacheHit.length;
    expect(mean).toBeGreaterThan(0.89);
    expect(mean).toBeLessThan(0.95);
    expect(t.policyBumps.length).toBeGreaterThan(0);
    const b = t.policyBumps[0]!;
    expect(t.cacheHit[b]!).toBeLessThan(0.5);
    expect(t.cacheHit[b + 30]!).toBeGreaterThan(0.85);
  });
  it('the isolation forest surfaces all three injected anomalies', () => {
    const tagged = new Set(catalog.filter((r) => r.state !== 'CLEAR').map((r) => r.id));
    const alerts = buildAnomalies(events, tagged);
    for (const inj of INJECTED)
      expect(alerts.some((a) => a.principal === inj.principal && a.score > 0.65)).toBe(true);
    expect(catalogMap.size).toBeGreaterThan(0);
  });
}, 60000);
