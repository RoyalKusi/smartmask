import { EngineError, type Value } from '../types';
import type { Expr, Join, Query, QueryBody, Select, TableRef } from './ast';

export interface TableData {
  name: string;
  columns: readonly string[];
  rows: readonly (readonly Value[])[];
}

export interface TableProvider {
  get(name: string): TableData | undefined;
}

export interface RowSet {
  columns: string[];
  rows: Value[][];
}

interface Frame {
  /** Qualified column names, parallel to the row arrays: alias.column */
  cols: { alias: string; name: string }[];
  rows: Value[][];
}

type Scope = Map<string, RowSet>;

const lc = (s: string): string => s.toLowerCase();

class Env {
  private readonly idx = new Map<string, number>();
  private readonly bare = new Map<string, number[]>();
  constructor(
    readonly cols: { alias: string; name: string }[],
    readonly aliases: Map<string, Expr>,
    readonly outer: Env | null,
    readonly outerRow: readonly Value[] | null,
  ) {
    cols.forEach((c, i) => {
      this.idx.set(`${lc(c.alias)}.${lc(c.name)}`, i);
      const arr = this.bare.get(lc(c.name)) ?? [];
      arr.push(i);
      this.bare.set(lc(c.name), arr);
    });
  }
  find(table: string | undefined, name: string): number {
    if (table) return this.idx.get(`${lc(table)}.${lc(name)}`) ?? -1;
    const arr = this.bare.get(lc(name));
    return arr && arr.length ? (arr[0] as number) : -1;
  }
}

function truthy(v: Value): boolean {
  return v !== null && v !== false && v !== 0 && v !== '';
}

function cmp(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a)) ? Number(a) : a;
  const nb = typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b)) ? Number(b) : b;
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  return String(a).localeCompare(String(b));
}

function likeToRegex(pattern: string, ci: boolean): RegExp {
  const src = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${src}$`, ci ? 'is' : 's');
}

const AGG = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

function hasAgg(e: Expr): boolean {
  switch (e.k) {
    case 'fn':
      return AGG.has(e.name) || e.args.some(hasAgg);
    case 'bin':
      return hasAgg(e.l) || hasAgg(e.r);
    case 'un':
    case 'cast':
    case 'isnull':
      return hasAgg(e.e);
    case 'case':
      return (
        (e.operand ? hasAgg(e.operand) : false) ||
        e.whens.some((w) => hasAgg(w.c) || hasAgg(w.t)) ||
        (e.else ? hasAgg(e.else) : false)
      );
    case 'between':
      return hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi);
    case 'in':
      return hasAgg(e.e);
    default:
      return false;
  }
}

class Executor {
  private readonly subCache = new WeakMap<Query, RowSet | 'correlated'>();
  constructor(private readonly provider: TableProvider) {}

  /** Uncorrelated subqueries run once; correlated ones (that fail without the outer row) run per row. */
  private sub(q: Query, ctx: Ctx): RowSet {
    const hit = this.subCache.get(q);
    if (hit && hit !== 'correlated') return hit;
    if (!hit) {
      try {
        const rs = this.run(q, ctx.scope);
        this.subCache.set(q, rs);
        return rs;
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        this.subCache.set(q, 'correlated');
      }
    }
    return this.run(q, ctx.scope, ctx.env, ctx.row);
  }

  run(
    q: Query,
    outerScope: Scope = new Map(),
    outerEnv: Env | null = null,
    outerRow: readonly Value[] | null = null,
  ): RowSet {
    const scope: Scope = new Map(outerScope);
    for (const c of q.ctes) {
      const rs = this.run(c.q, scope);
      scope.set(lc(c.name), c.cols ? { columns: c.cols, rows: rs.rows } : rs);
    }
    return this.body(q.body, scope, outerEnv, outerRow);
  }

  private body(b: QueryBody, scope: Scope, oe: Env | null, or: readonly Value[] | null): RowSet {
    if (b.k === 'select') return this.select(b, scope, oe, or);
    const l = this.body(b.l, scope, oe, or);
    const r = this.body(b.r, scope, oe, or);
    let rows = [...l.rows, ...r.rows];
    if (!b.all) {
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const k = JSON.stringify(row);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return { columns: l.columns, rows };
  }

  private source(ref: TableRef, scope: Scope): Frame {
    if (ref.k === 'derived') {
      const rs = this.run(ref.q, scope);
      return { cols: rs.columns.map((name) => ({ alias: ref.alias, name })), rows: rs.rows };
    }
    const alias = ref.alias ?? ref.name;
    const cte = scope.get(lc(ref.name));
    if (cte && !ref.schema) return { cols: cte.columns.map((name) => ({ alias, name })), rows: cte.rows };
    const t = this.provider.get(ref.name);
    if (!t) throw new EngineError('SM-CAT-002', `Unknown table "${ref.name}".`);
    return { cols: t.columns.map((name) => ({ alias, name })), rows: t.rows as Value[][] };
  }

  private join(left: Frame, j: Join, scope: Scope, oe: Env | null, or: readonly Value[] | null): Frame {
    const right = this.source(j.src, scope);
    const cols = [...left.cols, ...right.cols];
    const nullsR = new Array<Value>(right.cols.length).fill(null);
    const nullsL = new Array<Value>(left.cols.length).fill(null);
    const rows: Value[][] = [];
    if (j.type === 'CROSS' || !j.on) {
      for (const l of left.rows) for (const r of right.rows) rows.push([...l, ...r]);
      return { cols, rows };
    }
    const env = new Env(cols, new Map(), oe, or);
    // Hash join when ON is a single column = column across the two sides.
    const on = j.on;
    let li = -1;
    let ri = -1;
    if (on.k === 'bin' && on.op === '=' && on.l.k === 'col' && on.r.k === 'col') {
      const a = env.find(on.l.table, on.l.name);
      const b = env.find(on.r.table, on.r.name);
      if (a >= 0 && b >= 0) {
        if (a < left.cols.length && b >= left.cols.length) [li, ri] = [a, b - left.cols.length];
        else if (b < left.cols.length && a >= left.cols.length) [li, ri] = [b, a - left.cols.length];
      }
    }
    const matchedRight = new Set<number>();
    if (li >= 0) {
      const map = new Map<string, number[]>();
      right.rows.forEach((r, i) => {
        const v = r[ri] as Value;
        if (v === null) return;
        const k = String(v);
        const arr = map.get(k);
        if (arr) arr.push(i);
        else map.set(k, [i]);
      });
      for (const l of left.rows) {
        const v = l[li] as Value;
        const hits = v === null ? undefined : map.get(String(v));
        if (hits) {
          for (const h of hits) {
            rows.push([...l, ...(right.rows[h] as Value[])]);
            matchedRight.add(h);
          }
        } else if (j.type === 'LEFT' || j.type === 'FULL') rows.push([...l, ...nullsR]);
      }
    } else {
      for (const l of left.rows) {
        let any = false;
        right.rows.forEach((r, i) => {
          const row = [...l, ...r];
          if (truthy(this.eval(on, new Ctx(env, row, null, scope)))) {
            rows.push(row);
            matchedRight.add(i);
            any = true;
          }
        });
        if (!any && (j.type === 'LEFT' || j.type === 'FULL')) rows.push([...l, ...nullsR]);
      }
    }
    if (j.type === 'RIGHT' || j.type === 'FULL') {
      right.rows.forEach((r, i) => {
        if (!matchedRight.has(i)) rows.push([...nullsL, ...r]);
      });
    }
    return { cols, rows };
  }

  private select(s: Select, scope: Scope, oe: Env | null, or: readonly Value[] | null): RowSet {
    let frame: Frame = s.from ? this.source(s.from, scope) : { cols: [], rows: [[]] };
    for (const j of s.joins) frame = this.join(frame, j, scope, oe, or);

    const aliasMap = new Map<string, Expr>();
    s.items.forEach((it) => it.alias && aliasMap.set(lc(it.alias), it.expr));
    const env = new Env(frame.cols, aliasMap, oe, or);

    let rows = frame.rows;
    if (s.where) {
      const w = s.where;
      rows = rows.filter((r) => truthy(this.eval(w, new Ctx(env, r, null, scope))));
    }

    // Projection list with * expanded.
    const outCols: string[] = [];
    const outExprs: Expr[] = [];
    for (const it of s.items) {
      if (it.expr.k === 'star') {
        const t = it.expr.table;
        for (const c of frame.cols) {
          if (t && lc(c.alias) !== lc(t)) continue;
          outCols.push(c.name);
          outExprs.push({ k: 'col', table: c.alias, name: c.name });
        }
      } else {
        outCols.push(
          it.alias ??
            (it.expr.k === 'col'
              ? it.expr.name
              : it.expr.k === 'fn'
                ? it.expr.name.toLowerCase()
                : `col${outCols.length + 1}`),
        );
        outExprs.push(it.expr);
      }
    }

    const aggregate = s.groupBy.length > 0 || outExprs.some(hasAgg) || (s.having ? hasAgg(s.having) : false);
    let produced: { out: Value[]; ctx: Ctx }[] = [];
    if (aggregate) {
      const groups = new Map<string, Value[][]>();
      if (s.groupBy.length) {
        for (const r of rows) {
          const key = JSON.stringify(s.groupBy.map((g) => this.eval(g, new Ctx(env, r, null, scope))));
          const arr = groups.get(key);
          if (arr) arr.push(r);
          else groups.set(key, [r]);
        }
      } else groups.set('', rows);
      for (const grp of groups.values()) {
        const rep = grp[0] ?? new Array<Value>(frame.cols.length).fill(null);
        const ctx = new Ctx(env, rep, grp, scope);
        if (s.having && !truthy(this.eval(s.having, ctx))) continue;
        produced.push({ out: outExprs.map((e) => this.eval(e, ctx)), ctx });
      }
    } else {
      produced = rows.map((r) => {
        const ctx = new Ctx(env, r, null, scope);
        return { out: outExprs.map((e) => this.eval(e, ctx)), ctx };
      });
    }

    if (s.orderBy.length) {
      const keys = produced.map((p) => ({
        p,
        k: s.orderBy.map((o) => {
          if (o.e.k === 'col' && !o.e.table) {
            const oi = outCols.findIndex((c) => lc(c) === lc((o.e as { name: string }).name));
            if (oi >= 0 && env.find(undefined, o.e.name) < 0) return p.out[oi] as Value;
          }
          return this.eval(o.e, p.ctx);
        }),
      }));
      keys.sort((a, b) => {
        for (let i = 0; i < s.orderBy.length; i++) {
          const x = a.k[i] as Value;
          const y = b.k[i] as Value;
          const d = x === null ? (y === null ? 0 : -1) : y === null ? 1 : cmp(x, y);
          if (d !== 0) return (s.orderBy[i] as { desc: boolean }).desc ? -d : d;
        }
        return 0;
      });
      produced = keys.map((k) => k.p);
    }
    let out = produced.map((p) => p.out);
    if (s.distinct) {
      const seen = new Set<string>();
      out = out.filter((r) => {
        const k = JSON.stringify(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    if (s.offset) out = out.slice(s.offset);
    if (s.limit !== undefined) out = out.slice(0, s.limit);
    return { columns: outCols, rows: out };
  }

  eval(e: Expr, ctx: Ctx): Value {
    switch (e.k) {
      case 'lit':
        return e.v;
      case 'col': {
        let env: Env | null = ctx.env;
        let row: readonly Value[] | null = ctx.row;
        while (env) {
          const i = env.find(e.table, e.name);
          if (i >= 0 && row) return row[i] as Value;
          if (!e.table) {
            const a = env.aliases.get(lc(e.name));
            if (a) return this.eval(a, new Ctx(env, row ?? [], ctx.group, ctx.scope));
          }
          row = env.outerRow;
          env = env.outer;
        }
        throw new EngineError('SM-CAT-002', `Unknown column "${e.table ? `${e.table}.` : ''}${e.name}".`);
      }
      case 'star':
        return 1;
      case 'un': {
        const v = this.eval(e.e, ctx);
        if (e.op === 'NOT') return v === null ? null : !truthy(v);
        if (v === null) return null;
        return e.op === '-' ? -Number(v) : Number(v);
      }
      case 'bin':
        return this.bin(e, ctx);
      case 'isnull': {
        const v = this.eval(e.e, ctx);
        return e.not ? v !== null : v === null;
      }
      case 'between': {
        const v = this.eval(e.e, ctx);
        const lo = this.eval(e.lo, ctx);
        const hi = this.eval(e.hi, ctx);
        if (v === null || lo === null || hi === null) return null;
        const r = cmp(v, lo) >= 0 && cmp(v, hi) <= 0;
        return e.not ? !r : r;
      }
      case 'in': {
        const v = this.eval(e.e, ctx);
        if (v === null) return null;
        let list: Value[];
        if (e.sub) list = this.sub(e.sub, ctx).rows.map((r) => r[0] as Value);
        else list = (e.list ?? []).map((x) => this.eval(x, ctx));
        const hit = list.some((x) => x !== null && cmp(v, x) === 0);
        return e.not ? !hit : hit;
      }
      case 'exists': {
        const r = this.sub(e.sub, ctx);
        return e.not ? r.rows.length === 0 : r.rows.length > 0;
      }
      case 'sub': {
        const r = this.sub(e.q, ctx);
        return (r.rows[0]?.[0] as Value | undefined) ?? null;
      }
      case 'case': {
        const op = e.operand ? this.eval(e.operand, ctx) : null;
        for (const w of e.whens) {
          const c = this.eval(w.c, ctx);
          if (e.operand ? op !== null && c !== null && cmp(op, c) === 0 : truthy(c))
            return this.eval(w.t, ctx);
        }
        return e.else ? this.eval(e.else, ctx) : null;
      }
      case 'cast': {
        const v = this.eval(e.e, ctx);
        if (v === null) return null;
        const t = e.type.toLowerCase();
        if (/int|numeric|decimal|real|float|double/.test(t)) return Number(v);
        return String(v);
      }
      case 'fn':
        return this.fn(e, ctx);
    }
  }

  private bin(e: Extract<Expr, { k: 'bin' }>, ctx: Ctx): Value {
    if (e.op === 'AND') {
      const l = this.eval(e.l, ctx);
      if (l !== null && !truthy(l)) return false;
      const r = this.eval(e.r, ctx);
      if (r !== null && !truthy(r)) return false;
      return l === null || r === null ? null : true;
    }
    if (e.op === 'OR') {
      const l = this.eval(e.l, ctx);
      if (truthy(l)) return true;
      const r = this.eval(e.r, ctx);
      if (truthy(r)) return true;
      return l === null || r === null ? null : false;
    }
    const l = this.eval(e.l, ctx);
    const r = this.eval(e.r, ctx);
    if (l === null || r === null) return null;
    switch (e.op) {
      case '=':
        return cmp(l, r) === 0;
      case '<>':
        return cmp(l, r) !== 0;
      case '<':
        return cmp(l, r) < 0;
      case '>':
        return cmp(l, r) > 0;
      case '<=':
        return cmp(l, r) <= 0;
      case '>=':
        return cmp(l, r) >= 0;
      case 'LIKE':
        return likeToRegex(String(r), false).test(String(l));
      case 'ILIKE':
        return likeToRegex(String(r), true).test(String(l));
      case '+':
        return Number(l) + Number(r);
      case '-':
        return Number(l) - Number(r);
      case '*':
        return Number(l) * Number(r);
      case '/':
        return Number(r) === 0 ? null : Number(l) / Number(r);
      case '%':
        return Number(r) === 0 ? null : Number(l) % Number(r);
      case '||':
        return String(l) + String(r);
      default:
        throw new EngineError('SM-PARSE-001', `Unsupported operator ${e.op}.`);
    }
  }

  private fn(e: Extract<Expr, { k: 'fn' }>, ctx: Ctx): Value {
    if (AGG.has(e.name)) {
      const grp = ctx.group ?? [];
      const arg = e.args[0];
      if (e.name === 'COUNT' && (!arg || arg.k === 'star')) return grp.length;
      let vals = grp
        .map((r) => this.eval(arg as Expr, new Ctx(ctx.env, r, null, ctx.scope)))
        .filter((v) => v !== null);
      if (e.distinct) vals = [...new Map(vals.map((v) => [String(v), v])).values()];
      switch (e.name) {
        case 'COUNT':
          return vals.length;
        case 'SUM':
          return vals.length ? vals.reduce<number>((a, v) => a + Number(v), 0) : null;
        case 'AVG':
          return vals.length ? vals.reduce<number>((a, v) => a + Number(v), 0) / vals.length : null;
        case 'MIN':
          return vals.length ? vals.reduce((a, v) => (cmp(v as Value, a as Value) < 0 ? v : a)) : null;
        default:
          return vals.length ? vals.reduce((a, v) => (cmp(v as Value, a as Value) > 0 ? v : a)) : null;
      }
    }
    const a = e.args.map((x) => this.eval(x, ctx));
    const s = (i: number): string => String(a[i] ?? '');
    switch (e.name) {
      case 'UPPER':
        return a[0] === null ? null : s(0).toUpperCase();
      case 'LOWER':
        return a[0] === null ? null : s(0).toLowerCase();
      case 'LENGTH':
      case 'LEN':
        return a[0] === null ? null : Array.from(s(0)).length;
      case 'TRIM':
        return a[0] === null ? null : s(0).trim();
      case 'SUBSTR':
      case 'SUBSTRING': {
        if (a[0] === null) return null;
        const start = Math.max(1, Number(a[1] ?? 1));
        const chars = Array.from(s(0));
        return a[2] === undefined
          ? chars.slice(start - 1).join('')
          : chars.slice(start - 1, start - 1 + Number(a[2])).join('');
      }
      case 'COALESCE':
        return a.find((v) => v !== null) ?? null;
      case 'ROUND':
        return a[0] === null ? null : Number(Number(a[0]).toFixed(Number(a[1] ?? 0)));
      case 'ABS':
        return a[0] === null ? null : Math.abs(Number(a[0]));
      case 'CONCAT':
        return a.map((v) => (v === null ? '' : String(v))).join('');
      case 'REPLACE':
        return a[0] === null ? null : s(0).split(s(1)).join(s(2));
      case 'DATE':
        return a[0] === null ? null : s(0).slice(0, 10);
      default:
        throw new EngineError('SM-PARSE-001', `Unsupported function ${e.name}().`);
    }
  }
}

class Ctx {
  constructor(
    readonly env: Env,
    readonly row: readonly Value[],
    readonly group: readonly Value[][] | null,
    readonly scope: Scope,
  ) {}
}

export function executeQuery(q: Query, provider: TableProvider): RowSet {
  return new Executor(provider).run(q);
}
