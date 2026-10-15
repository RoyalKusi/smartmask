import { canonicalJson, sha256HexSync } from './hash';
import type { Role } from './types';

export type AuditEventType =
  | 'QUERY'
  | 'ROLE_SWITCH'
  | 'POLICY_PUBLISH'
  | 'REVIEW_DECISION'
  | 'SCAN'
  | 'ALERT_ACTION'
  | 'BACKEND_ADDED'
  | 'EXPORT'
  | 'SCHEMA_DRIFT';

export interface AuditBody {
  id: number;
  event_type: AuditEventType;
  timestamp: string;
  principal: string;
  requesting_role: Role;
  backend: string;
  query_hash: string | null;
  columns_accessed: string[];
  masking_applied: { column: string; function: string }[];
  execution_time_ms: number;
  rows_returned: number;
  stages: { parse: number; policy: number; mutation: number; render: number; audit: number } | null;
  outcome: 'ALLOWED' | 'DENIED';
  code: string | null;
  detail: string;
  policy_version: number;
}

export interface AuditEvent extends AuditBody {
  prev_hash: string;
  event_hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export function bodyOf(e: AuditEvent): AuditBody {
  const { prev_hash: _p, event_hash: _h, ...body } = e;
  void _p;
  void _h;
  return body;
}

export function hashEvent(body: AuditBody, prevHash: string): string {
  return sha256HexSync(`${prevHash}|${canonicalJson(body)}`);
}

export function sealEvent(body: AuditBody, prevHash: string): AuditEvent {
  return { ...body, prev_hash: prevHash, event_hash: hashEvent(body, prevHash) };
}

export type ChainFault = 'hash_mismatch' | 'link_mismatch';

export interface ChainVerdict {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
  fault: ChainFault | null;
}

/** Walk the chain from genesis; the first inconsistent event is reported and everything after it is untrusted. */
export async function verifyChain(
  events: readonly AuditEvent[],
  onProgress?: (done: number) => void,
): Promise<ChainVerdict> {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as AuditEvent;
    if (e.prev_hash !== prev) return { ok: false, checked: i + 1, brokenAt: i, fault: 'link_mismatch' };
    const h = hashEvent(bodyOf(e), e.prev_hash);
    if (h !== e.event_hash) return { ok: false, checked: i + 1, brokenAt: i, fault: 'hash_mismatch' };
    prev = e.event_hash;
    if (onProgress && i % 1000 === 0) {
      onProgress(i);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return { ok: true, checked: events.length, brokenAt: null, fault: null };
}

/** Corrupt one event in place of its stored copy without re-sealing it (the attacker has no key). */
export function tamper(events: readonly AuditEvent[], index: number): AuditEvent[] {
  return events.map((e, i) =>
    i === index ? { ...e, execution_time_ms: Math.round((e.execution_time_ms + 0.37) * 100) / 100, detail: `${e.detail} ` } : e,
  );
}
