import { sha256HexSync } from '../engine/hash';
import type { TableData, TableProvider } from '../engine/sql/exec';
import type { Value } from '../engine/types';
import { TABLES, generateRows, tableByName, type TableSpec } from './schema';

const BLOCK = 2000;

/**
 * Deterministic in-browser dataset. Base tables are generated once, frozen, and never mutated:
 * the masking engine only ever reads from them.
 */
export class Dataset implements TableProvider {
  private readonly rows = new Map<string, readonly (readonly Value[])[]>();
  private readonly renames = new Map<string, Map<string, string>>();

  private full(spec: TableSpec): readonly (readonly Value[])[] {
    let r = this.rows.get(spec.name);
    if (!r) {
      const gen = generateRows(spec);
      for (const row of gen) Object.freeze(row);
      r = Object.freeze(gen);
      this.rows.set(spec.name, r);
    }
    return r;
  }

  columnNames(spec: TableSpec): string[] {
    const m = this.renames.get(spec.name);
    return spec.columns.map((c) => m?.get(c.name) ?? c.name);
  }

  get(name: string): TableData | undefined {
    const spec = tableByName(name);
    if (!spec) return undefined;
    return { name: spec.name, columns: this.columnNames(spec), rows: this.full(spec) };
  }

  /** First n rows (a stable prefix of the full table) for the scanner. */
  sample(name: string, n: number): Value[][] {
    const spec = tableByName(name);
    if (!spec) return [];
    const cached = this.rows.get(spec.name);
    return (cached ? cached.slice(0, n) : generateRows(spec, n)) as Value[][];
  }

  rowCount(name: string): number {
    return tableByName(name)?.rows ?? 0;
  }

  /** Simulates an upstream DDL rename. Row data is untouched, so checksums stay identical. */
  renameColumn(table: string, from: string, to: string): void {
    const spec = tableByName(table);
    if (!spec) return;
    const m = this.renames.get(spec.name) ?? new Map<string, string>();
    m.set(from, to);
    this.renames.set(spec.name, m);
  }

  hasRename(table: string): boolean {
    return (this.renames.get(table)?.size ?? 0) > 0;
  }

  /** Merkle-style SHA-256 over 2,000-row blocks of the table's row data. */
  async checksum(name: string): Promise<string> {
    const spec = tableByName(name);
    if (!spec) throw new Error(`Unknown table ${name}`);
    const rows = this.full(spec);
    const blocks: string[] = [];
    for (let i = 0; i < rows.length; i += BLOCK) {
      blocks.push(sha256HexSync(JSON.stringify(rows.slice(i, i + BLOCK))));
      if (i % (BLOCK * 8) === 0) await new Promise<void>((r) => setTimeout(r, 0));
    }
    return sha256HexSync(`${spec.name}|${rows.length}|${blocks.join('')}`);
  }

  tableNames(): string[] {
    return TABLES.map((t) => t.name);
  }
}

export const dataset = new Dataset();
