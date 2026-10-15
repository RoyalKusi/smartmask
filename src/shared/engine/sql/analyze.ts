import { EngineError, type ColumnState, type Dialect, type Family, type Role, type Tag, type Violation } from '../types';
import { resolveMask, type Policy } from '../policy';
import type { MaskArgs, MaskFn } from '../masking';
import type { Expr, Join, Query, QueryBody, Select, SelectItem, TableRef } from './ast';

export interface TagInfo {
  tag: Tag;
  family?: Family;
  state: ColumnState;
}

export type Approach = 'views' | 'ast';

export interface AnalyzeEnv {
  role: Role;
  dialect: Dialect;
  approach: Approach;
  policy: Policy;
  /** Canonical column list for a base table, or undefined when the table does not exist. */
  schema: (table: string) => { name: string; columns: string[] } | undefined;
  /** Tag info when a column must be masked (ENFORCED, ENFORCED_ML, REVIEW fail-closed, tag overrides). */
  tagInfo: (table: string, column: string) => TagInfo | null;
}

export interface OutCol {
  name: string;
  /** Base columns this output depends on, as "table.column". */
  sources: string[];
  /** True when the output is an untouched passthrough of exactly one base column. */
  direct: boolean;
  mask?: { fn: MaskFn; args: MaskArgs; tag: Tag; family?: Family };
}

export interface AppliedMask {
  column: string;
  fn: MaskFn;
  tag: Tag;
}

export interface Analysis {
  outCols: OutCol[];
  violations: Violation[];
  referenced: string[];
  tables: string[];
  masks: AppliedMask[];
  rewritten: Query;
}

export const roleSchema = (role: Role): string => `sm_secure_${role.replace('ROLE_', '').toLowerCase()}`;

interface Source {
  alias: string;
  table?: string;
  cols: OutCol[];
}

interface Ctx {
  env: AnalyzeEnv;
  violations: Violation[];
  referenced: Set<string>;
  tables: Set<string>;
  masks: AppliedMask[];
}

interface Lineage {
  sources: string[];
  direct: boolean;
  hasCol: boolean;
}

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function lit(v: string | number): Expr {
  return typeof v === 'number' ? { k: 'lit', v, raw: String(v) } : { k: 'lit', v, raw: `'${v.replace(/'/g, "''")}'` };
}

export function maskFnName(fn: Exclude<MaskFn, 'PLAINTEXT' | 'REDACT'>, dialect: Dialect): string {
  const base = fn.toLowerCase();
  return dialect === 'mysql' ? `SM_${fn}` : dialect === 'sqlite' ? `sm_${base}` : `smartmask.${base}`;
}

export function maskExpr(
  fn: MaskFn,
  args: MaskArgs,
  inner: Expr,
  dialect: Dialect,
  tag: Tag,
): Expr {
  switch (fn) {
    case 'PLAINTEXT':
      return inner;
    case 'REDACT':
      return lit('[REDACTED]');
    case 'PARTIAL_KEEP':
      return { k: 'fn', name: maskFnName(fn, dialect), args: [inner, lit(args.keep_first ?? 0), lit(args.keep_last ?? 0)] };
    case 'PARTIAL_EMAIL':
      return { k: 'fn', name: maskFnName(fn, dialect), args: [inner] };
    case 'BUCKET':
      return { k: 'fn', name: maskFnName(fn, dialect), args: [inner, lit(args.width ?? 50000)] };
    case 'HMAC_TOKEN':
      return { k: 'fn', name: maskFnName(fn, dialect), args: [inner, lit(tag)] };
  }
}

function lookupCte(scope: Map<string, OutCol[]>, name: string): OutCol[] | undefined {
  for (const [k, v] of scope) if (eq(k, name)) return v;
  return undefined;
}

function processQuery(q: Query, ctx: Ctx, outer: Map<string, OutCol[]>, top: boolean): { cols: OutCol[]; q: Query } {
  const scope = new Map(outer);
  const ctes: Query['ctes'] = [];
  for (const c of q.ctes) {
    const r = processQuery(c.q, ctx, scope, false);
    const cols = c.cols ? r.cols.map((x, i) => ({ ...x, name: c.cols?.[i] ?? x.name })) : r.cols;
    scope.set(c.name, cols);
    ctes.push({ ...c, q: r.q });
  }
  const body = processBody(q.body, ctx, scope, top);
  return { cols: body.cols, q: { ctes, body: body.body } };
}

function processBody(b: QueryBody, ctx: Ctx, scope: Map<string, OutCol[]>, top: boolean): { cols: OutCol[]; body: QueryBody } {
  if (b.k === 'select') {
    const r = processSelect(b, ctx, scope, top);
    return { cols: r.cols, body: r.sel };
  }
  const l = processBody(b.l, ctx, scope, top);
  const r = processBody(b.r, ctx, scope, top);
  if (l.cols.length !== r.cols.length) {
    throw new EngineError('SM-PARSE-001', 'UNION branches must return the same number of columns.');
  }
  const cols = l.cols.map((c, i) => {
    const rc = r.cols[i] as OutCol;
    return { ...c, sources: [...new Set([...c.sources, ...rc.sources])], direct: c.direct && rc.direct && c.sources.join() === rc.sources.join() };
  });
  return { cols, body: { k: 'union', all: b.all, l: l.body, r: r.body } };
}

function processSelect(sel: Select, ctx: Ctx, scope: Map<string, OutCol[]>, top: boolean): { cols: OutCol[]; sel: Select } {
  const { env } = ctx;
  const secure = env.role !== 'ROLE_ADMIN';
  const sources: Source[] = [];

  const addRef = (r: TableRef): TableRef => {
    if (r.k === 'derived') {
      const res = processQuery(r.q, ctx, scope, false);
      sources.push({ alias: r.alias, cols: res.cols });
      return { ...r, q: res.q };
    }
    const cte = lookupCte(scope, r.name);
    if (cte && !r.schema) {
      sources.push({ alias: r.alias ?? r.name, cols: cte });
      return r;
    }
    const def = env.schema(r.name);
    if (!def) throw new EngineError('SM-CAT-002', `Unknown table "${r.name}".`);
    ctx.tables.add(def.name);
    sources.push({
      alias: r.alias ?? r.name,
      table: def.name,
      cols: def.columns.map((c) => ({ name: c, sources: [`${def.name}.${c}`], direct: true })),
    });
    if (env.approach === 'views' && secure) {
      return { k: 'table', schema: roleSchema(env.role), name: def.name, alias: r.alias ?? r.name };
    }
    return r;
  };

  const from = sel.from ? addRef(sel.from) : undefined;
  const joinsNoOn: Join[] = sel.joins.map((j) => ({ ...j, src: addRef(j.src) }));

  const tagged = (id: string): TagInfo | null => {
    const dot = id.indexOf('.');
    return env.tagInfo(id.slice(0, dot), id.slice(dot + 1));
  };
  const addViolation = (v: Violation): void => {
    if (!ctx.violations.some((x) => x.code === v.code && x.message === v.message)) ctx.violations.push(v);
  };

  const aliasMap = new Map<string, Expr>();

  const resolveCol = (e: Extract<Expr, { k: 'col' }>, allowAlias: boolean): OutCol => {
    const hits: OutCol[] = [];
    for (const s of sources) {
      if (e.table && !eq(s.alias, e.table) && !(s.table && eq(s.table, e.table))) continue;
      for (const c of s.cols) if (eq(c.name, e.name)) hits.push(c);
    }
    if (hits.length > 1 && !e.table) {
      const distinct = new Set(hits.map((h) => h.sources.join()));
      if (distinct.size > 1) throw new EngineError('SM-PARSE-001', `Column "${e.name}" is ambiguous; qualify it with a table alias.`);
    }
    const hit = hits[0];
    if (hit) return hit;
    if (allowAlias && !e.table) {
      const a = [...aliasMap.entries()].find(([k]) => eq(k, e.name));
      if (a) {
        const l = lineageOf(a[1], false);
        return { name: e.name, sources: l.sources, direct: l.direct };
      }
    }
    throw new EngineError('SM-CAT-002', `Unknown column "${e.table ? `${e.table}.` : ''}${e.name}".`);
  };

  function lineageOf(e: Expr, allowAlias: boolean): Lineage {
    switch (e.k) {
      case 'col': {
        const c = resolveCol(e, allowAlias);
        c.sources.forEach((s) => ctx.referenced.add(s));
        return { sources: c.sources, direct: c.direct, hasCol: true };
      }
      case 'lit':
      case 'star':
        return { sources: [], direct: false, hasCol: false };
      case 'sub':
      case 'exists': {
        const r = processQuery(e.k === 'sub' ? e.q : e.sub, ctx, scope, false);
        return { sources: r.cols.flatMap((c) => c.sources), direct: false, hasCol: true };
      }
      default:
        return mergeLineage(children(e).map((c) => lineageOf(c, allowAlias)), e);
    }
  }

  function mergeLineage(parts: Lineage[], e: Expr): Lineage {
    let extra: Lineage[] = [];
    if (e.k === 'in' && e.sub) {
      const r = processQuery(e.sub, ctx, scope, false);
      extra = [{ sources: r.cols.flatMap((c) => c.sources), direct: false, hasCol: true }];
    }
    const all = [...parts, ...extra];
    return {
      sources: [...new Set(all.flatMap((p) => p.sources))],
      direct: false,
      hasCol: all.some((p) => p.hasCol),
    };
  }

  const taggedOf = (l: Lineage): string[] => l.sources.filter((s) => tagged(s));
  const colNames = (ids: string[]): string => [...new Set(ids)].join(', ');

  function checkPredicate(e: Expr): void {
    switch (e.k) {
      case 'bin': {
        if (e.op === 'AND' || e.op === 'OR') {
          checkPredicate(e.l);
          checkPredicate(e.r);
          return;
        }
        if (['=', '<>', '<', '>', '<=', '>=', 'LIKE', 'ILIKE'].includes(e.op)) {
          comparison(e.l, [e.r], e.op);
          comparison(e.r, [e.l], e.op);
          return;
        }
        break;
      }
      case 'un':
        if (e.op === 'NOT') {
          checkPredicate(e.e);
          return;
        }
        break;
      case 'between':
        comparison(e.e, [e.lo, e.hi], 'BETWEEN');
        lineageOf(e.lo, true);
        lineageOf(e.hi, true);
        return;
      case 'in':
        if (e.list) {
          comparison(e.e, e.list, 'IN');
          e.list.forEach((x) => lineageOf(x, true));
        } else {
          const l = lineageOf(e.e, true);
          if (taggedOf(l).length && !l.direct) derived(l);
          if (e.sub) processQuery(e.sub, ctx, scope, false);
        }
        return;
      case 'isnull': {
        const l = lineageOf(e.e, true);
        if (taggedOf(l).length && !l.direct) derived(l);
        return;
      }
      default:
        break;
    }
    const l = lineageOf(e, true);
    if (taggedOf(l).length) derived(l);
  }

  function derived(l: Lineage): void {
    addViolation({
      code: 'SM-DERIVED-001',
      message: `A derived expression over tagged column(s) ${colNames(taggedOf(l))} is not allowed for ${env.role}. Select or compare the column directly.`,
      column: taggedOf(l)[0] as string,
    });
  }

  function comparison(side: Expr, others: Expr[], op: string): void {
    const l = lineageOf(side, true);
    const t = taggedOf(l);
    if (!t.length) {
      others.forEach((o) => lineageOf(o, true));
      return;
    }
    const literalOnly = others.every((o) => {
      const lo = lineageOf(o, true);
      return !lo.hasCol;
    });
    if (literalOnly) {
      addViolation({
        code: 'SM-PRED-001',
        message: `Predicate ${op} against a literal on tagged column ${colNames(t)} is rejected for ${env.role}: it would let a caller probe raw values.`,
        column: t[0] as string,
      });
    } else if (!l.direct) derived(l);
  }

  // Aliases first so ORDER BY / HAVING may reference them.
  sel.items.forEach((it) => {
    if (it.alias) aliasMap.set(it.alias, it.expr);
  });

  const joins: Join[] = joinsNoOn.map((j) => {
    if (j.on && secure) checkPredicate(j.on);
    else if (j.on) lineageOf(j.on, false);
    return j;
  });
  if (sel.where) secure ? checkPredicate(sel.where) : lineageOf(sel.where, false);
  if (sel.having) secure ? checkPredicate(sel.having) : lineageOf(sel.having, true);
  sel.groupBy.forEach((g) => lineageOf(g, true));
  sel.orderBy.forEach((o) => lineageOf(o.e, true));

  // Expand * so that each output column can be traced (and masked).
  const expand = top && (env.approach === 'ast' || !secure) ? true : false;
  const items: SelectItem[] = [];
  const outs: { item: SelectItem; col: OutCol; expr: Expr }[] = [];
  const pushItem = (item: SelectItem): void => {
    if (item.expr.k === 'star') {
      const star = item.expr;
      const relevant = sources.filter((s) => !star.table || eq(s.alias, star.table) || (s.table && eq(s.table, star.table)));
      if (star.table && !relevant.length) throw new EngineError('SM-CAT-002', `Unknown table or alias "${star.table}".`);
      for (const s of relevant) {
        for (const c of s.cols) {
          c.sources.forEach((x) => ctx.referenced.add(x));
          const expr: Expr = { k: 'col', table: s.alias, name: c.name };
          outs.push({ item: { expr, ...(c.name ? { alias: undefined } : {}) }, col: c, expr });
        }
      }
      return;
    }
    const l = lineageOf(item.expr, false);
    const name = item.alias ?? (item.expr.k === 'col' ? item.expr.name : item.expr.k === 'fn' ? item.expr.name.toLowerCase() : `col${outs.length + 1}`);
    outs.push({ item, col: { name, sources: l.sources, direct: l.direct && item.expr.k === 'col' }, expr: item.expr });
  };
  sel.items.forEach(pushItem);

  for (const o of outs) {
    let expr = o.expr;
    const col = o.col;
    if (top && secure) {
      const t = taggedOf({ sources: col.sources, direct: col.direct, hasCol: true });
      if (t.length) {
        if (col.direct && col.sources.length === 1) {
          const id = col.sources[0] as string;
          const info = tagged(id) as TagInfo;
          const r = resolveMask(env.policy, env.role, info.tag, info.family);
          if (r.fn !== 'PLAINTEXT') {
            col.mask = { fn: r.fn, args: r.args, tag: info.tag, ...(info.family ? { family: info.family } : {}) };
            ctx.masks.push({ column: id, fn: r.fn, tag: info.tag });
            if (env.approach === 'ast') expr = maskExpr(r.fn, r.args, expr, env.dialect, info.tag);
          }
        } else {
          derived({ sources: col.sources, direct: false, hasCol: true });
        }
      }
    }
    const needsAlias = expr !== o.expr || (o.item.alias === undefined && expand && col.name !== (expr.k === 'col' ? expr.name : ''));
    items.push({ expr, ...(o.item.alias ? { alias: o.item.alias } : needsAlias || expr.k !== 'col' ? { alias: col.name } : {}) });
  }

  const hasStar = sel.items.some((i) => i.expr.k === 'star');
  const finalItems = hasStar && !expand ? sel.items : items;
  const out: Select = { ...sel, items: finalItems, joins };
  if (from) out.from = from;
  return { cols: outs.map((o) => o.col), sel: out };
}

function children(e: Expr): Expr[] {
  switch (e.k) {
    case 'fn':
      return e.args;
    case 'bin':
      return [e.l, e.r];
    case 'un':
    case 'cast':
    case 'isnull':
      return [e.e];
    case 'case':
      return [...(e.operand ? [e.operand] : []), ...e.whens.flatMap((w) => [w.c, w.t]), ...(e.else ? [e.else] : [])];
    case 'in':
      return [e.e, ...(e.list ?? [])];
    case 'between':
      return [e.e, e.lo, e.hi];
    default:
      return [];
  }
}

export function analyzeQuery(q: Query, env: AnalyzeEnv): Analysis {
  const ctx: Ctx = { env, violations: [], referenced: new Set(), tables: new Set(), masks: [] };
  const r = processQuery(q, ctx, new Map(), true);
  return {
    outCols: r.cols,
    violations: ctx.violations,
    referenced: [...ctx.referenced].sort(),
    tables: [...ctx.tables].sort(),
    masks: ctx.masks,
    rewritten: r.q,
  };
}

/** DDL for the per-role secure view of one base table (Approach A, PostgreSQL). */
export function secureViewDdl(env: AnalyzeEnv, table: string): string {
  const def = env.schema(table);
  if (!def) throw new EngineError('SM-CAT-002', `Unknown table "${table}".`);
  const cols = def.columns.map((c) => {
    const info = env.tagInfo(def.name, c);
    if (!info) return `  ${c}`;
    const r = resolveMask(env.policy, env.role, info.tag, info.family);
    if (r.fn === 'PLAINTEXT') return `  ${c}`;
    const e = maskExpr(r.fn, r.args, { k: 'col', name: c }, 'postgresql', info.tag);
    const txt = e.k === 'lit' ? e.raw : e.k === 'fn' ? `${e.name}(${e.args.map((a) => (a.k === 'col' ? a.name : a.k === 'lit' ? a.raw : '')).join(', ')})` : c;
    return `  ${txt} AS ${c}`;
  });
  return `CREATE OR REPLACE VIEW ${roleSchema(env.role)}.${def.name} AS\nSELECT\n${cols.join(',\n')}\nFROM public.${def.name};`;
}
