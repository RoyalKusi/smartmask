import { scoreColumn, shapeHistogram } from '../engine/scoring';
import type { BackendId } from '../engine/types';
import type { ColumnRecord } from './catalogTypes';
import { dataset } from './dataset';
import { BACKENDS, TABLES, type TableSpec } from './schema';

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
      history: [
        {
          at: scannedAt,
          by: 'scanner',
          action: 'SCAN',
          from: null,
          to: r.state,
          reason: `S=${r.s.toFixed(3)} M=${r.m.toFixed(2)}`,
        },
      ],
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

export { effectiveTag } from './catalogTypes';
export type { ColumnOverride, ColumnRecord, Decision } from './catalogTypes';
