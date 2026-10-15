import type { AuditEvent, ChainVerdict } from '../engine/audit';
import type { Dialect, Role, Tag, Violation } from '../engine/types';
import type { PipelineResult, StageTimings } from '../engine/pipeline';
import type { ColumnRecord } from '../data/catalog';
import type { AnomalyAlert } from '../data/anomalies';
import type { PolicyVersionLog, Principal, ScanLog } from '../data/principals';
import type { ScanStage } from '../engine/fsm';
import type { Policy } from '../engine/policyCore';

export type ActivityKind = 'scan' | 'policy' | 'review' | 'role' | 'alert' | 'query' | 'export' | 'backend' | 'audit' | 'drift';
export interface ActivityItem {
  id: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  actor: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
}

export interface VerificationBatch {
  id: string;
  at: string;
  label: string;
  actor: string;
  tables: { table: string; before: string; after: string }[];
  match: boolean;
}

export interface BackendInfo {
  id: string;
  label: string;
  dialect: Dialect;
  engine: string;
  approach: 'views' | 'ast';
  host: string;
  status: 'connected' | 'degraded';
  tables: number;
  columns: number;
  lastScan: string | null;
  custom: boolean;
}

export interface OverviewData {
  columnsDiscovered: number;
  enforced: number;
  review: number;
  queries24h: number;
  p99: number;
  volume: { hour: string; start: number; ROLE_ADMIN: number; ROLE_SUPPORT: number; ROLE_ANALYST: number }[];
  tagDistribution: { tag: Tag | 'CLEAR'; count: number }[];
  activity: ActivityItem[];
}

export interface PolicyData {
  text: string;
  policy: Policy;
  version: number;
  history: PolicyVersionLog[];
}

export interface GoldenDiffRow {
  queryId: string;
  title: string;
  role: Role;
  changedCells: number;
  totalCells: number;
  before: string;
  after: string;
  note: string;
}

export interface QueryRunResult {
  pipeline: PipelineResult | null;
  violations: Violation[];
  role: Role;
  stages: StageTimings | null;
  cacheHit: boolean;
  audit: AuditEvent;
  tables: string[];
  backend: string;
  fatal: Violation | null;
}

export interface ScanProgress {
  stage: ScanStage;
  pct: number;
  revealed: ColumnRecord[];
}

export interface ScanSummary {
  backend: string;
  columns: number;
  enforced: number;
  review: number;
  added: string[];
  removed: string[];
  durationMs: number;
}

export interface AuditData {
  events: AuditEvent[];
  verdict: (ChainVerdict & { at: string }) | null;
  tamperedAt: number | null;
}

export interface PerformanceData {
  hours: { start: number; p50: number; p95: number; p99: number; total: number; stages: Record<'parse' | 'policy' | 'mutation' | 'render' | 'audit', number> }[];
  stageMeans: Record<'parse' | 'policy' | 'mutation' | 'render' | 'audit', number>;
  p50: number;
  p95: number;
  p99: number;
  cacheSeries: { t: number; ratio: number }[];
  cacheAvg: number;
  policyBumps: number[];
  lastBumpWall: number | null;
  bumpsLive: number;
}

export interface DecisionInput {
  columnId: string;
  action: 'APPROVE' | 'CLEAR' | 'FORCE_TAG' | 'OVERRIDE';
  tag?: Tag;
  mode?: 'CLEAR' | 'TAG';
  reason: string;
}

export interface Triage {
  action: 'APPROVE' | 'CLEAR' | 'FORCE_TAG';
  tag: Tag | null;
  reason: string;
  confidence: number;
}

export interface ReviewItem {
  record: ColumnRecord;
  triage: Triage;
}

export type { AnomalyAlert, AuditEvent, ChainVerdict, ColumnRecord, PolicyVersionLog, Principal, ScanLog };
