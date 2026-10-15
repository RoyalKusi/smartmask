import { scoreColumn, shapeHistogram, type MlContribution, type ShapeBin } from '../engine/scoring';
import type { TagInfo } from '../engine/sql/analyze';
import type { BackendId, ColumnState, Family, Tag } from '../engine/types';
import { dataset } from './dataset';
import { BACKENDS, TABLES, type TableSpec } from './schema';

export interface Decision {
  at: string;
  by: string;
  action: 'SCAN' | 'APPROVE' | 'CLEAR' | 'FORCE_TAG' | 'OVERRIDE' | 'UNDO' | 'DRIFT';
  from: ColumnState | null;
  to: ColumnState;
  reason: string;
}

export interface ColumnOverride {
  mode: 'CLEAR' | 'TAG';
  tag?: Tag;
  justification: string;
}

export interface ColumnRecord {
  id: string;
  backend: BackendId;
  table: string;
  column: string;
  dtype: string;
  family: Family;
  tag: Tag | null;
  suggestedTag: Tag | null;
  n: number;
  p: number;
  e: number;
  s: number;
  m: number;
  state: ColumnState;
  nullRate: number;
  emptyRate: number;
  sampleSize: number;
  rowCount: number;
  emptyTableFloor: boolean;
  shapes: ShapeBin[];
  mlContributions: MlContribution[];
  override?: ColumnOverride;
  history: Decision[];
  scannedAt: string;
}

export const SAMPLE_SIZE = 400;

export function scanTable(spec: TableSpec, scannedAt: string): ColumnRecord[] {
  const sample = dataset.sample(spec.name, SAMPLE_SIZE);
  const names = dataset.columnNames(spec);
  const empty = spec.rows === 0;
  return spec.columns.map((col, ci) => {
    const name = names[ci] as string;
    const values = sample.map((r) => r[ci] ?? null);
    const r = scoreColumn(name, values, empty);
    return {
      id: `${spec.name}.${name}`,
      backend: spec.backend,
      table: spec.name,
      column: name,
      dtype: col.type,
      family: r.family,
      tag: r.tag,
      suggestedTag: r.suggestedTag,
      n: r.n,
      p: r.p,
      e: r.e,
      s: r.s,
      m: r.m,
      state: r.state,
      nullRate: r.nullRate,
      emptyRate: r.emptyRate,
      sampleSize: r.sampleSize,
      rowCount: spec.rows,
      emptyTableFloor: r.emptyTableFloor,
      shapes: shapeHistogram(values),
      mlContributions: r.mlContributions,
      history: [{ at: scannedAt, by: 'scanner', action: 'SCAN', from: null, to: r.state, reason: `S=${r.s.toFixed(3)} M=${r.m.toFixed(2)}` }],
      scannedAt,
    };
  });
}

export function scanBackend(backend: BackendId, scannedAt: string): ColumnRecord[] {
  return TABLES.filter((t) => t.backend === backend).flatMap((t) => scanTable(t, scannedAt));
}

export function scanAll(scannedAt: string): ColumnRecord[] {
  return BACKENDS.flatMap((b) => scanBackend(b.id, scannedAt));
}

/**
 * The masking decision the engine acts on for one catalog record.
 * REVIEW is masked fail-closed using the best-guess tag; CLEAR and cleared overrides pass through.
 */
export function effectiveTag(rec: ColumnRecord | undefined): TagInfo | null {
  if (!rec) return { tag: 'PII_MEDIUM', state: 'REVIEW' };
  switch (rec.state) {
    case 'ENFORCED':
    case 'ENFORCED_ML':
      return { tag: rec.tag ?? rec.suggestedTag ?? 'PII_MEDIUM', family: rec.family, state: rec.state };
    case 'REVIEW':
      return { tag: rec.suggestedTag ?? 'PII_MEDIUM', family: rec.family, state: rec.state };
    case 'OVERRIDDEN':
      return rec.override?.mode === 'TAG' && rec.override.tag
        ? { tag: rec.override.tag, family: rec.family, state: rec.state }
        : null;
    case 'CLEAR':
      return null;
  }
}
