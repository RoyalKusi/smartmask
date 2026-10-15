import { EngineError } from '../types';
import type { Expr, Join, Query, QueryBody, Select, SelectItem, TableRef } from './ast';
import { tokenize, type Token } from './tokenizer';

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private get cur(): Token {
    return this.toks[this.i] as Token;
  }
  private peek(o = 1): Token {
    return (this.toks[this.i + o] ?? this.toks[this.toks.length - 1]) as Token;
  }
  private fail(msg: string): never {
    const t = this.cur;
    throw new EngineError(
      'SM-PARSE-001',
      `${msg} near ${t.t === 'eof' ? 'end of input' : `"${t.v}"`}.`,
      t.pos,
    );
  }
  private isKw(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.t === 'kw' && t.v === v;
  }
  private isP(v: string, o = 0): boolean {
    const t = this.peek(o);
    return (t.t === 'punct' || t.t === 'op') && t.v === v;
  }
  private acceptKw(v: string): boolean {
    if (this.isKw(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  private acceptP(v: string): boolean {
    if (this.isP(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expectKw(v: string): void {
    if (!this.acceptKw(v)) this.fail(`Expected ${v}`);
  }
  private expectP(v: string): void {
    if (!this.acceptP(v)) this.fail(`Expected "${v}"`);
  }
  private ident(): string {
    const t = this.cur;
    if (t.t === 'id' || t.t === 'qid') {
      this.i++;
      return t.v;
    }
    return this.fail('Expected an identifier');
  }

  parseStatement(): Query {
    const q = this.parseQuery();
    this.acceptP(';');
    if (this.cur.t !== 'eof') this.fail('Unexpected trailing input');
    return q;
  }

  parseQuery(): Query {
    const ctes: Query['ctes'] = [];
    if (this.acceptKw('WITH')) {
      this.acceptKw('RECURSIVE');
      do {
        const name = this.ident();
        let cols: string[] | undefined;
        if (this.acceptP('(')) {
          cols = [];
          do cols.push(this.ident());
          while (this.acceptP(','));
          this.expectP(')');
        }
        this.expectKw('AS');
        this.expectP('(');
        const q = this.parseQuery();
        this.expectP(')');
        ctes.push({ name, ...(cols ? { cols } : {}), q });
      } while (this.acceptP(','));
    }
    return { ctes, body: this.parseBody() };
  }

  private parseBody(): QueryBody {
    let left: QueryBody = this.parseSelect();
    while (this.isKw('UNION')) {
      this.i++;
      const all = this.acceptKw('ALL');
      left = { k: 'union', all, l: left, r: this.parseSelect() };
    }
    return left;
  }

  private parseSelect(): Select {
    if (this.isP('(')) {
      // parenthesised select branch
      this.i++;
      const inner = this.parseBody();
      this.expectP(')');
      if (inner.k !== 'select') this.fail('Nested set operations in parentheses are not supported');
      return inner;
    }
    this.expectKw('SELECT');
    const distinct = this.acceptKw('DISTINCT');
    this.acceptKw('ALL');
    const items: SelectItem[] = [];
    do items.push(this.parseItem());
    while (this.acceptP(','));
    const sel: Select = { k: 'select', distinct, items, joins: [], groupBy: [], orderBy: [] };
    if (this.acceptKw('FROM')) {
      sel.from = this.parseTableRef();
      for (;;) {
        if (this.acceptP(',')) {
          sel.joins.push({ type: 'CROSS', src: this.parseTableRef() });
          continue;
        }
        const j = this.parseJoin();
        if (!j) break;
        sel.joins.push(j);
      }
    }
    if (this.acceptKw('WHERE')) sel.where = this.parseExpr();
    if (this.acceptKw('GROUP')) {
      this.expectKw('BY');
      do sel.groupBy.push(this.parseExpr());
      while (this.acceptP(','));
    }
    if (this.acceptKw('HAVING')) sel.having = this.parseExpr();
    if (this.acceptKw('ORDER')) {
      this.expectKw('BY');
      do {
        const e = this.parseExpr();
        const desc = this.acceptKw('DESC');
        if (!desc) this.acceptKw('ASC');
        sel.orderBy.push({ e, desc });
      } while (this.acceptP(','));
    }
    if (this.acceptKw('LIMIT')) {
      sel.limit = this.intLiteral();
      if (this.acceptP(',')) {
        sel.offset = sel.limit;
        sel.limit = this.intLiteral();
      }
    }
    if (this.acceptKw('OFFSET')) sel.offset = this.intLiteral();
    return sel;
  }

  private intLiteral(): number {
    const t = this.cur;
    if (t.t !== 'num') this.fail('Expected a number');
    this.i++;
    return Math.max(0, Math.floor(Number(t.v)));
  }

  private parseJoin(): Join | null {
    let type: Join['type'] | null = null;
    if (this.isKw('JOIN')) type = 'INNER';
    else if (this.isKw('INNER') && this.isKw('JOIN', 1)) {
      this.i++;
      type = 'INNER';
    } else if (this.isKw('LEFT') || this.isKw('RIGHT') || this.isKw('FULL')) {
      type = this.cur.v as Join['type'];
      this.i++;
      this.acceptKw('OUTER');
    } else if (this.isKw('CROSS')) {
      this.i++;
      type = 'CROSS';
    }
    if (!type) return null;
    this.expectKw('JOIN');
    const src = this.parseTableRef();
    const join: Join = { type, src };
    if (type !== 'CROSS') {
      this.expectKw('ON');
      join.on = this.parseExpr();
    }
    return join;
  }

  private parseTableRef(): TableRef {
    if (this.acceptP('(')) {
      const q = this.parseQuery();
      this.expectP(')');
      this.acceptKw('AS');
      return { k: 'derived', q, alias: this.ident() };
    }
    let name = this.ident();
    let schema: string | undefined;
    if (this.acceptP('.')) {
      schema = name;
      name = this.ident();
    }
    let alias: string | undefined;
    if (this.acceptKw('AS')) alias = this.ident();
    else if (this.cur.t === 'id' || this.cur.t === 'qid') alias = this.ident();
    return { k: 'table', ...(schema ? { schema } : {}), name, ...(alias ? { alias } : {}) };
  }

  private parseItem(): SelectItem {
    if (this.isP('*')) {
      this.i++;
      return { expr: { k: 'star' } };
    }
    const expr = this.parseExpr();
    let alias: string | undefined;
    if (this.acceptKw('AS')) alias = this.ident();
    else if (this.cur.t === 'id' || this.cur.t === 'qid') alias = this.ident();
    return { expr, ...(alias ? { alias } : {}) };
  }

  parseExpr(): Expr {
    return this.parseOr();
  }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.acceptKw('OR')) l = { k: 'bin', op: 'OR', l, r: this.parseAnd() };
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseNot();
    while (this.acceptKw('AND')) l = { k: 'bin', op: 'AND', l, r: this.parseNot() };
    return l;
  }
  private parseNot(): Expr {
    if (this.isKw('NOT') && !this.isKw('EXISTS', 1)) {
      this.i++;
      return { k: 'un', op: 'NOT', e: this.parseNot() };
    }
    return this.parseCmp();
  }
  private parseCmp(): Expr {
    let l = this.parseAdd();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.i++;
        l = { k: 'bin', op: t.v, l, r: this.parseAdd() };
      } else if (this.isKw('IS')) {
        this.i++;
        const not = this.acceptKw('NOT');
        this.expectKw('NULL');
        l = { k: 'isnull', e: l, not };
      } else {
        const not =
          this.isKw('NOT') &&
          (this.isKw('IN', 1) || this.isKw('LIKE', 1) || this.isKw('ILIKE', 1) || this.isKw('BETWEEN', 1));
        if (not) this.i++;
        if (this.acceptKw('IN')) {
          this.expectP('(');
          if (this.isKw('SELECT') || this.isKw('WITH')) {
            const sub = this.parseQuery();
            this.expectP(')');
            l = { k: 'in', e: l, sub, not };
          } else {
            const list: Expr[] = [];
            do list.push(this.parseExpr());
            while (this.acceptP(','));
            this.expectP(')');
            l = { k: 'in', e: l, list, not };
          }
        } else if (this.isKw('LIKE') || this.isKw('ILIKE')) {
          const op = this.cur.v;
          this.i++;
          const r = this.parseAdd();
          const e: Expr = { k: 'bin', op, l, r };
          l = not ? { k: 'un', op: 'NOT', e } : e;
        } else if (this.acceptKw('BETWEEN')) {
          const lo = this.parseAdd();
          this.expectKw('AND');
          l = { k: 'between', e: l, lo, hi: this.parseAdd(), not };
        } else break;
      }
    }
    return l;
  }
  private parseAdd(): Expr {
    let l = this.parseMul();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && ['+', '-', '||'].includes(t.v)) {
        this.i++;
        l = { k: 'bin', op: t.v, l, r: this.parseMul() };
      } else return l;
    }
  }
  private parseMul(): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && ['*', '/', '%'].includes(t.v)) {
        this.i++;
        l = { k: 'bin', op: t.v, l, r: this.parseUnary() };
      } else return l;
    }
  }
  private parseUnary(): Expr {
    if (this.cur.t === 'op' && (this.cur.v === '-' || this.cur.v === '+')) {
      const op = this.cur.v;
      this.i++;
      return { k: 'un', op, e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.cur;
    if (t.t === 'num') {
      this.i++;
      return { k: 'lit', v: Number(t.v), raw: t.v };
    }
    if (t.t === 'str') {
      this.i++;
      return { k: 'lit', v: t.v, raw: `'${t.v.replace(/'/g, "''")}'` };
    }
    if (t.t === 'kw') {
      if (t.v === 'NULL') return this.litKw(null, 'NULL');
      if (t.v === 'TRUE') return this.litKw(true, 'TRUE');
      if (t.v === 'FALSE') return this.litKw(false, 'FALSE');
      if (t.v === 'CASE') return this.parseCase();
      if (t.v === 'CAST') {
        this.i++;
        this.expectP('(');
        const e = this.parseExpr();
        this.expectKw('AS');
        const type = this.ident();
        this.expectP(')');
        return { k: 'cast', e, type };
      }
      if (t.v === 'EXISTS' || (t.v === 'NOT' && this.isKw('EXISTS', 1))) {
        const not = t.v === 'NOT';
        this.i += not ? 2 : 1;
        this.expectP('(');
        const sub = this.parseQuery();
        this.expectP(')');
        return { k: 'exists', sub, not };
      }
    }
    if (this.isP('(')) {
      this.i++;
      if (this.isKw('SELECT') || this.isKw('WITH')) {
        const q = this.parseQuery();
        this.expectP(')');
        return { k: 'sub', q };
      }
      const e = this.parseExpr();
      this.expectP(')');
      return e;
    }
    if (t.t === 'id' || t.t === 'qid') {
      this.i++;
      if (this.isP('(') && t.t === 'id') {
        this.i++;
        const name = t.v.toUpperCase();
        const distinct = this.acceptKw('DISTINCT');
        const args: Expr[] = [];
        if (this.isP('*')) {
          this.i++;
          args.push({ k: 'star' });
        } else if (!this.isP(')')) {
          do args.push(this.parseExpr());
          while (this.acceptP(','));
        }
        this.expectP(')');
        return { k: 'fn', name, args, ...(distinct ? { distinct } : {}) };
      }
      if (this.isP('.')) {
        this.i++;
        if (this.isP('*')) {
          this.i++;
          return { k: 'star', table: t.v };
        }
        let name = this.ident();
        let table = t.v;
        if (this.acceptP('.')) {
          table = name;
          name = this.ident();
        }
        return { k: 'col', table, name };
      }
      return { k: 'col', name: t.v };
    }
    return this.fail('Expected an expression');
  }

  private litKw(v: boolean | null, raw: string): Expr {
    this.i++;
    return { k: 'lit', v, raw };
  }

  private parseCase(): Expr {
    this.i++;
    let operand: Expr | undefined;
    if (!this.isKw('WHEN')) operand = this.parseExpr();
    const whens: { c: Expr; t: Expr }[] = [];
    while (this.acceptKw('WHEN')) {
      const c = this.parseExpr();
      this.expectKw('THEN');
      whens.push({ c, t: this.parseExpr() });
    }
    if (!whens.length) this.fail('CASE needs at least one WHEN');
    let els: Expr | undefined;
    if (this.acceptKw('ELSE')) els = this.parseExpr();
    this.expectKw('END');
    return { k: 'case', ...(operand ? { operand } : {}), whens, ...(els ? { else: els } : {}) };
  }
}

export function parseSql(sql: string): Query {
  if (!sql.trim()) throw new EngineError('SM-PARSE-001', 'The query is empty.', 0);
  return new Parser(tokenize(sql)).parseStatement();
}
