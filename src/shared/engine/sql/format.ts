import type { Dialect } from '../types';
import type { Expr, Query, QueryBody, Select, TableRef } from './ast';
import { KEYWORDS } from './tokenizer';

export interface FormatOptions {
  dialect: Dialect;
  /** Replace literals with ? for hashing and audit. */
  stripLiterals?: boolean;
}

function quoteId(name: string, d: Dialect): string {
  if (/^[a-z_][a-z0-9_]*$/i.test(name) && !KEYWORDS.has(name.toUpperCase())) return name;
  return d === 'mysql' ? `\`${name}\`` : `"${name.replace(/"/g, '""')}"`;
}

export function formatExpr(e: Expr, o: FormatOptions): string {
  const f = (x: Expr): string => formatExpr(x, o);
  switch (e.k) {
    case 'col':
      return e.table
        ? `${quoteId(e.table, o.dialect)}.${quoteId(e.name, o.dialect)}`
        : quoteId(e.name, o.dialect);
    case 'lit':
      return o.stripLiterals && e.v !== null && typeof e.v !== 'boolean' ? '?' : e.raw;
    case 'star':
      return e.table ? `${quoteId(e.table, o.dialect)}.*` : '*';
    case 'fn':
      return `${e.name}(${e.distinct ? 'DISTINCT ' : ''}${e.args.map(f).join(', ')})`;
    case 'bin': {
      const wrap = (x: Expr): string =>
        x.k === 'bin' && precedence(x.op) < precedence(e.op) ? `(${f(x)})` : f(x);
      return `${wrap(e.l)} ${e.op} ${wrap(e.r)}`;
    }
    case 'un':
      return e.op === 'NOT' ? `NOT ${f(e.e)}` : `${e.op}${f(e.e)}`;
    case 'case':
      return `CASE${e.operand ? ` ${f(e.operand)}` : ''}${e.whens.map((w) => ` WHEN ${f(w.c)} THEN ${f(w.t)}`).join('')}${e.else ? ` ELSE ${f(e.else)}` : ''} END`;
    case 'in':
      return `${f(e.e)}${e.not ? ' NOT' : ''} IN (${e.sub ? formatQuery(e.sub, o, 0, true) : (e.list ?? []).map(f).join(', ')})`;
    case 'exists':
      return `${e.not ? 'NOT ' : ''}EXISTS (${formatQuery(e.sub, o, 0, true)})`;
    case 'sub':
      return `(${formatQuery(e.q, o, 0, true)})`;
    case 'between':
      return `${f(e.e)}${e.not ? ' NOT' : ''} BETWEEN ${f(e.lo)} AND ${f(e.hi)}`;
    case 'isnull':
      return `${f(e.e)} IS${e.not ? ' NOT' : ''} NULL`;
    case 'cast':
      return `CAST(${f(e.e)} AS ${e.type})`;
  }
}

function precedence(op: string): number {
  if (op === 'OR') return 1;
  if (op === 'AND') return 2;
  if (['=', '<>', '<', '>', '<=', '>=', 'LIKE', 'ILIKE'].includes(op)) return 3;
  if (['+', '-', '||'].includes(op)) return 4;
  return 5;
}

function formatRef(r: TableRef, o: FormatOptions, depth: number): string {
  const pad = '  '.repeat(depth);
  if (r.k === 'derived')
    return `(\n${formatQuery(r.q, o, depth + 1)}\n${pad}) AS ${quoteId(r.alias, o.dialect)}`;
  const nm = `${r.schema ? `${quoteId(r.schema, o.dialect)}.` : ''}${quoteId(r.name, o.dialect)}`;
  return r.alias ? `${nm} AS ${quoteId(r.alias, o.dialect)}` : nm;
}

function formatSelect(s: Select, o: FormatOptions, depth: number): string {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  const items = s.items.map(
    (it) => `${formatExpr(it.expr, o)}${it.alias ? ` AS ${quoteId(it.alias, o.dialect)}` : ''}`,
  );
  lines.push(`${pad}SELECT ${s.distinct ? 'DISTINCT ' : ''}${items.join(`,\n${pad}       `)}`);
  if (s.from) lines.push(`${pad}FROM ${formatRef(s.from, o, depth)}`);
  for (const j of s.joins) {
    lines.push(
      `${pad}${j.type === 'CROSS' ? 'CROSS' : j.type} JOIN ${formatRef(j.src, o, depth)}${j.on ? ` ON ${formatExpr(j.on, o)}` : ''}`,
    );
  }
  if (s.where) lines.push(`${pad}WHERE ${formatExpr(s.where, o)}`);
  if (s.groupBy.length) lines.push(`${pad}GROUP BY ${s.groupBy.map((x) => formatExpr(x, o)).join(', ')}`);
  if (s.having) lines.push(`${pad}HAVING ${formatExpr(s.having, o)}`);
  if (s.orderBy.length)
    lines.push(
      `${pad}ORDER BY ${s.orderBy.map((x) => formatExpr(x.e, o) + (x.desc ? ' DESC' : '')).join(', ')}`,
    );
  if (s.limit !== undefined) lines.push(`${pad}LIMIT ${s.limit}${s.offset ? ` OFFSET ${s.offset}` : ''}`);
  else if (s.offset) lines.push(`${pad}OFFSET ${s.offset}`);
  return lines.join('\n');
}

function formatBody(b: QueryBody, o: FormatOptions, depth: number): string {
  if (b.k === 'select') return formatSelect(b, o, depth);
  const pad = '  '.repeat(depth);
  return `${formatBody(b.l, o, depth)}\n${pad}UNION${b.all ? ' ALL' : ''}\n${formatBody(b.r, o, depth)}`;
}

export function formatQuery(q: Query, o: FormatOptions, depth = 0, inline = false): string {
  const pad = '  '.repeat(depth);
  let out = '';
  if (q.ctes.length) {
    out += `${pad}WITH ${q.ctes
      .map(
        (c) =>
          `${quoteId(c.name, o.dialect)}${c.cols ? `(${c.cols.map((x) => quoteId(x, o.dialect)).join(', ')})` : ''} AS (\n${formatQuery(c.q, o, depth + 1)}\n${pad})`,
      )
      .join(`,\n${pad}     `)}\n`;
  }
  out += formatBody(q.body, o, depth);
  return inline ? out.replace(/\n\s*/g, ' ') : out;
}
