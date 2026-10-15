import { describe, expect, it } from 'vitest';
import { analyzeQuery, secureViewDdl, type AnalyzeEnv } from '../../src/shared/engine/sql/analyze';
import { formatQuery } from '../../src/shared/engine/sql/format';
import { parseSql } from '../../src/shared/engine/sql/parser';
import { EngineError, type Dialect, type Role } from '../../src/shared/engine/types';
import { policy, tagInfo } from './helpers';
import { schemaLookup } from '../../src/shared/data/runtime';

const env = (role: Role, dialect: Dialect, approach: 'views' | 'ast'): AnalyzeEnv => ({
  role,
  dialect,
  approach,
  policy,
  schema: schemaLookup,
  tagInfo,
});
const rewrite = (sql: string, role: Role, dialect: Dialect = 'sqlite', approach: 'views' | 'ast' = 'ast') =>
  formatQuery(analyzeQuery(parseSql(sql), env(role, dialect, approach)).rewritten, { dialect });

describe('parser and formatter', () => {
  it('round-trips SELECT with aliases, joins, CTEs and subqueries', () => {
    const sql = `WITH a AS (SELECT account_id, balance FROM accounts WHERE status = 'ACTIVE')
      SELECT c.card_no AS pan, a.balance FROM cards c INNER JOIN a ON a.account_id = c.account_id
      WHERE c.customer_id IN (SELECT customer_id FROM loans) ORDER BY a.balance DESC LIMIT 5`;
    const once = formatQuery(parseSql(sql), { dialect: 'postgresql' });
    const twice = formatQuery(parseSql(once), { dialect: 'postgresql' });
    expect(twice).toBe(once);
  });
  it('rejects unparseable SQL with SM-PARSE-001', () => {
    for (const bad of [
      'SELEC * FROM x',
      'SELECT FROM',
      "SELECT 'unterminated",
      'SELECT a FROM t WHERE',
      '',
    ]) {
      try {
        parseSql(bad);
        throw new Error(`should have failed: ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(EngineError);
        expect((e as EngineError).code).toBe('SM-PARSE-001');
      }
    }
  });
  it('handles comments, quoted identifiers and escaped quotes', () => {
    const q = parseSql(`-- hi\nSELECT "full_name" /* c */ FROM \`customers\` WHERE city = 'O''Brien'`);
    expect(formatQuery(q, { dialect: 'sqlite' })).toContain("'O''Brien'");
  });
});

describe('rewriting golden tests', () => {
  const sql =
    'SELECT c.card_no, a.balance FROM cards c JOIN accounts a ON a.account_id = c.account_id WHERE c.customer_id = 1';
  it('Admin: unchanged semantics, no masking functions', () => {
    expect(rewrite(sql, 'ROLE_ADMIN')).not.toMatch(/sm_/);
  });
  it('Support / SQLite (Approach B): PARTIAL_KEEP and BUCKET UDFs wrap the projection', () => {
    const r = rewrite(sql, 'ROLE_SUPPORT', 'sqlite');
    expect(r).toContain('sm_partial_keep(c.card_no, 4, 4) AS card_no');
    expect(r).toContain('sm_bucket(a.balance, 50000) AS balance');
  });
  it('Support / MySQL: upper-case UDF naming', () => {
    expect(rewrite(sql, 'ROLE_SUPPORT', 'mysql')).toContain('SM_PARTIAL_KEEP(c.card_no, 4, 4) AS card_no');
  });
  it('Analyst: token for PII_HIGH, literal [REDACTED] for FINANCIAL (no column reference left)', () => {
    const r = rewrite(sql, 'ROLE_ANALYST', 'sqlite');
    expect(r).toContain("sm_hmac_token(c.card_no, 'PII_HIGH') AS card_no");
    expect(r).toContain("'[REDACTED]' AS balance");
  });
  it('PostgreSQL (Approach A) targets per-role secure views and emits their DDL', () => {
    const r = rewrite(sql, 'ROLE_SUPPORT', 'postgresql', 'views');
    expect(r).toContain('sm_secure_support.cards AS c');
    expect(r).not.toContain('sm_partial_keep');
    const ddl = secureViewDdl(env('ROLE_SUPPORT', 'postgresql', 'views'), 'cards');
    expect(ddl).toContain('CREATE OR REPLACE VIEW sm_secure_support.cards');
    expect(ddl).toContain('smartmask.partial_keep(card_no, 4, 4) AS card_no');
  });
  it('expands * and masks only tagged columns', () => {
    const r = rewrite('SELECT * FROM cards', 'ROLE_ANALYST');
    expect(r).toContain("sm_hmac_token(cards.card_no, 'PII_HIGH') AS card_no");
    expect(r).toContain('cards.card_id');
  });
  it('masks at the outermost projection through CTEs, subqueries and aliases', () => {
    const cte = rewrite('WITH t AS (SELECT card_no AS pan FROM cards) SELECT pan FROM t', 'ROLE_ANALYST');
    expect(cte).toContain("sm_hmac_token(pan, 'PII_HIGH') AS pan");
    const sub = rewrite('SELECT x.pan FROM (SELECT card_no AS pan FROM cards) x', 'ROLE_SUPPORT');
    expect(sub).toContain('sm_partial_keep(x.pan, 4, 4) AS pan');
  });
  it('masks UNION branches independently', () => {
    const r = rewrite('SELECT card_no FROM cards UNION SELECT c1 FROM legacy_cards', 'ROLE_ANALYST');
    expect(r.match(/sm_hmac_token/g)).toHaveLength(2);
  });
});

describe('policy violations', () => {
  const v = (sql: string, role: Role) =>
    analyzeQuery(parseSql(sql), env(role, 'sqlite', 'ast')).violations.map((x) => x.code);
  it('SM-PRED-001: literal predicate on a tagged column for Support and Analyst, never for Admin', () => {
    const sql = "SELECT customer_id FROM cards WHERE card_no = '4111-1111-1111-1111'";
    expect(v(sql, 'ROLE_SUPPORT')).toEqual(['SM-PRED-001']);
    expect(v(sql, 'ROLE_ANALYST')).toEqual(['SM-PRED-001']);
    expect(v(sql, 'ROLE_ADMIN')).toEqual([]);
  });
  it('SM-PRED-001 also covers IN lists, BETWEEN, LIKE and predicates reached through an alias', () => {
    expect(v("SELECT 1 FROM customers WHERE ssn IN ('1','2')", 'ROLE_ANALYST')).toContain('SM-PRED-001');
    expect(v('SELECT 1 FROM accounts WHERE balance BETWEEN 1 AND 5', 'ROLE_SUPPORT')).toContain(
      'SM-PRED-001',
    );
    expect(v("SELECT 1 FROM customers WHERE email LIKE '%@x%'", 'ROLE_ANALYST')).toContain('SM-PRED-001');
    expect(v("SELECT 1 FROM (SELECT ssn AS s FROM customers) t WHERE t.s = '123'", 'ROLE_ANALYST')).toContain(
      'SM-PRED-001',
    );
  });
  it('column-to-column comparison and joins on tagged columns are allowed (token joins work)', () => {
    expect(
      v('SELECT c.customer_id FROM customers c JOIN loans l ON l.applicant_ssn = c.ssn', 'ROLE_ANALYST'),
    ).toEqual([]);
  });
  it('SM-DERIVED-001: functions and aggregates over tagged columns', () => {
    expect(v('SELECT SUBSTR(card_no, 1, 4) FROM cards', 'ROLE_SUPPORT')).toContain('SM-DERIVED-001');
    expect(v('SELECT SUM(balance) FROM accounts', 'ROLE_ANALYST')).toContain('SM-DERIVED-001');
    expect(
      v('SELECT LOWER(email) FROM customers WHERE LOWER(email) = LOWER(email)', 'ROLE_ANALYST'),
    ).toContain('SM-DERIVED-001');
    expect(
      v('WITH t AS (SELECT UPPER(first_name) AS n FROM customers) SELECT n FROM t', 'ROLE_ANALYST'),
    ).toContain('SM-DERIVED-001');
    expect(v('SELECT SUM(balance) FROM accounts', 'ROLE_ADMIN')).toEqual([]);
  });
  it('COUNT(*) and untagged aggregates stay allowed', () => {
    expect(v('SELECT segment, COUNT(*) FROM customers GROUP BY segment', 'ROLE_ANALYST')).toEqual([]);
  });
  it('unknown table and ambiguous column are reported, not executed', () => {
    expect(() =>
      analyzeQuery(parseSql('SELECT x FROM nope'), env('ROLE_ADMIN', 'sqlite', 'ast')),
    ).toThrowError(/Unknown table/);
    expect(() =>
      analyzeQuery(
        parseSql('SELECT customer_id FROM customers c JOIN accounts a ON a.customer_id = c.customer_id'),
        env('ROLE_ADMIN', 'sqlite', 'ast'),
      ),
    ).toThrowError(/ambiguous/);
  });
  it('REVIEW columns are masked fail-closed', () => {
    const r = rewrite('SELECT order_ref FROM settlements', 'ROLE_ANALYST');
    expect(r).toContain('sm_hmac_token(order_ref');
  });
});
