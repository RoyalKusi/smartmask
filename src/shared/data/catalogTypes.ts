import type { MlContribution, ShapeBin } from '../engine/scoring';
import type { TagInfo } from '../engine/sql/analyze';
import type { BackendId, ColumnState, Family, Tag } from '../engine/types';

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
