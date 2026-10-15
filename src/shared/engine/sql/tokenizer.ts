import { EngineError } from '../types';

export type TokenType = 'kw' | 'id' | 'qid' | 'str' | 'num' | 'op' | 'punct' | 'eof';
export interface Token {
  t: TokenType;
  v: string;
  pos: number;
}

export const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'INNER', 'LEFT',
  'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE',
  'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'UNION', 'ALL', 'WITH', 'ASC',
  'DESC', 'TRUE', 'FALSE', 'CAST', 'RECURSIVE',
]);

const TWO = new Set(['<=', '>=', '<>', '!=', '||']);

export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new EngineError('SM-PARSE-001', 'Unterminated block comment.', i);
      i = end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= n) throw new EngineError('SM-PARSE-001', 'Unterminated string literal.', i);
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            v += "'";
            j += 2;
            continue;
          }
          break;
        }
        v += sql[j];
        j++;
      }
      out.push({ t: 'str', v, pos: i });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1);
      if (end < 0) throw new EngineError('SM-PARSE-001', 'Unterminated quoted identifier.', i);
      out.push({ t: 'qid', v: sql.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(sql[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\./.exec(sql.slice(i)) as RegExpExecArray;
      out.push({ t: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i + 1;
      while (j < n && /[\p{L}\p{N}_$]/u.test(sql[j] as string)) j++;
      const word = sql.slice(i, j);
      out.push({ t: KEYWORDS.has(word.toUpperCase()) ? 'kw' : 'id', v: KEYWORDS.has(word.toUpperCase()) ? word.toUpperCase() : word, pos: i });
      i = j;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (TWO.has(two)) {
      out.push({ t: 'op', v: two === '!=' ? '<>' : two, pos: i });
      i += 2;
      continue;
    }
    if ('=<>+-*/%'.includes(c)) {
      out.push({ t: 'op', v: c, pos: i });
      i++;
      continue;
    }
    if ('(),.;'.includes(c)) {
      out.push({ t: 'punct', v: c, pos: i });
      i++;
      continue;
    }
    throw new EngineError('SM-PARSE-001', `Unexpected character "${c}".`, i);
  }
  out.push({ t: 'eof', v: '', pos: n });
  return out;
}
