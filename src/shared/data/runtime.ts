import type { AnalyzeEnv, TagInfo } from '../engine/sql/analyze';
import { effectiveTag, type ColumnRecord } from './catalog';
import { dataset } from './dataset';
import { BACKEND_BY_ID, tableByName } from './schema';

/** Schema lookup that follows upstream renames. */
export const schemaLookup: AnalyzeEnv['schema'] = (table) => {
  const spec = tableByName(table);
  return spec ? { name: spec.name, columns: dataset.columnNames(spec) } : undefined;
};

export function makeTagInfo(records: ReadonlyMap<string, ColumnRecord>): AnalyzeEnv['tagInfo'] {
  return (table, column): TagInfo | null => effectiveTag(records.get(`${table}.${column}`));
}

export const dialectOf = (backend: string) => BACKEND_BY_ID.get(backend)?.dialect ?? 'postgresql';
export const approachOf = (backend: string) => BACKEND_BY_ID.get(backend)?.approach ?? 'ast';

/** Which backend owns the tables a query reads (first table wins). */
export function backendOfTables(tables: readonly string[]): string {
  const t = tables[0] ? tableByName(tables[0]) : undefined;
  return t?.backend ?? 'core_pg';
}
