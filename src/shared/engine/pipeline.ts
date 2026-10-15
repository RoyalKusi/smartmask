import { EngineError, ROLES, type Role, type Value, type Violation } from './types';
import { applyMask, type TokenVault } from './masking';
import { createRng, hashSeed, type Rng } from './prng';
import { analyzeQuery, secureViewDdl, type Analysis, type AnalyzeEnv, type Approach } from './sql/analyze';
import { executeQuery, type RowSet, type TableProvider } from './sql/exec';
import { formatQuery } from './sql/format';
import { parseSql } from './sql/parser';
import type { Query } from './sql/ast';
import type { Dialect } from './types';
import type { Policy } from './policyCore';

export const DISPLAY_ROW_CAP = 500;
export const STAGE_BUDGET_MS = 4.0;
export const P99_CEILING_MS = 5.0;

export type StageName = 'parse' | 'policy' | 'mutation' | 'execute' | 'render' | 'audit';
export interface StageTimings {
  parse: number;
  policy: number;
  mutation: number;
  /** Backend execution: not part of SmartMask overhead. */
  execute: number;
  render: number;
  audit: number;
  /** parse + policy + mutation + render + audit */
  overhead: number;
}

const RANGES: Record<Exclude<StageName, 'execute'>, [number, number]> = {
  parse: [0.4, 1.5],
  policy: [0.1, 0.3],
  mutation: [0.3, 1.2],
  render: [0.2, 0.8],
  audit: [0.05, 0.2],
};

/** Seeded, simulated stage timings. Not a measurement. */
export function simulateStages(rng: Rng, complexity: number, executeMs?: number): StageTimings {
  const k = Math.min(1, Math.max(0.05, complexity));
  const pick = (name: Exclude<StageName, 'execute'>): number => {
    const [lo, hi] = RANGES[name];
    const t = Math.min(1, Math.max(0, k * 0.65 + rng.next() * 0.35));
    return lo + (hi - lo) * t;
  };
  let parse = pick('parse');
  let policy = pick('policy');
  let mutation = pick('mutation');
  let render = pick('render');
  let audit = pick('audit');
  if (rng.chance(0.012)) {
    // Occasional P99 spike: capped at 4.6 ms, so the 5.0 ms ceiling is never crossed.
    const scale = rng.float(4.2, 4.6) / (parse + policy + mutation + render + audit);
    parse *= scale;
    policy *= scale;
    mutation *= scale;
    render *= scale;
    audit *= scale;
  }
  const r = (x: number): number => Math.round(x * 1000) / 1000;
  const overhead = parse + policy + mutation + render + audit;
  return {
    parse: r(parse),
    policy: r(policy),
    mutation: r(mutation),
    execute: r(executeMs ?? rng.float(80, 260)),
    render: r(render),
    audit: r(audit),
    overhead: r(overhead),
  };
}

export interface RoleOutcome {
  role: Role;
  violations: Violation[];
  analysis: Analysis | null;
  rewrittenSql: string;
  viewDdl: string[];
  masked: Value[][] | null;
}

export interface PipelineInput {
  sql: string;
  dialect: Dialect;
  approach: Approach;
  policy: Policy;
  schema: AnalyzeEnv['schema'];
  tagInfo: AnalyzeEnv['tagInfo'];
  provider: TableProvider;
  vault: TokenVault;
}

export interface PipelineResult {
  ast: Query;
  formattedSql: string;
  normalizedSql: string;
  raw: RowSet;
  rowCount: number;
  truncated: boolean;
  outcomes: Record<Role, RoleOutcome>;
  stages: Record<Role, StageTimings>;
}

export function normalizeSql(ast: Query, dialect: Dialect): string {
  return formatQuery(ast, { dialect, stripLiterals: true });
}

function violationsFrom(e: unknown): Violation[] {
  if (e instanceof EngineError) {
    const code = e.code === 'SM-CAT-002' ? 'SM-CAT-002' : 'SM-PARSE-001';
    return [{ code, message: e.message }];
  }
  throw e;
}

/**
 * Parse, validate and rewrite for every role, execute once against the base tables,
 * then mask per role. Parse errors throw EngineError('SM-PARSE-001').
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const ast = parseSql(input.sql);
  const fmt = { dialect: input.dialect } as const;
  const formattedSql = formatQuery(ast, fmt);
  const normalizedSql = normalizeSql(ast, input.dialect);

  let raw: RowSet = { columns: [], rows: [] };
  try {
    raw = executeQuery(ast, input.provider);
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
  }
  const rowCount = raw.rows.length;
  const truncated = rowCount > DISPLAY_ROW_CAP;
  const shown: RowSet = {
    columns: raw.columns,
    rows: truncated ? raw.rows.slice(0, DISPLAY_ROW_CAP) : raw.rows,
  };

  const outcomes = {} as Record<Role, RoleOutcome>;
  const stages = {} as Record<Role, StageTimings>;
  const complexity = Math.min(1, normalizedSql.length / 700);
  for (const role of ROLES) {
    const env: AnalyzeEnv = {
      role,
      dialect: input.dialect,
      approach: input.approach,
      policy: input.policy,
      schema: input.schema,
      tagInfo: input.tagInfo,
    };
    let analysis: Analysis | null = null;
    let violations: Violation[];
    try {
      analysis = analyzeQuery(ast, env);
      violations = analysis.violations;
    } catch (e) {
      violations = violationsFrom(e);
    }
    const stageRng = createRng(hashSeed(`${normalizedSql}|${role}|${input.policy.version}`));
    stages[role] = simulateStages(stageRng, complexity);
    if (!analysis || violations.length) {
      outcomes[role] = { role, violations, analysis: null, rewrittenSql: '', viewDdl: [], masked: null };
      continue;
    }
    const rewrittenSql = formatQuery(analysis.rewritten, fmt);
    const viewDdl =
      input.approach === 'views' && role !== 'ROLE_ADMIN'
        ? analysis.tables.map((t) => secureViewDdl(env, t))
        : [];
    const cols = analysis.outCols;
    const pairs: [string, string][] = [];
    cols.forEach((c, ci) => {
      if (c.mask?.fn === 'HMAC_TOKEN')
        for (const r of shown.rows)
          if (r[ci] !== null && r[ci] !== undefined) pairs.push([c.mask.tag, String(r[ci])]);
    });
    await input.vault.prime(pairs);
    const masked = shown.rows.map((r) =>
      r.map((v, ci) => {
        const m = cols[ci]?.mask;
        return m
          ? applyMask(m.fn, v, m.args, {
              tag: m.tag,
              ...(m.family ? { family: m.family } : {}),
              vault: input.vault,
            })
          : v;
      }),
    );
    outcomes[role] = { role, violations: [], analysis, rewrittenSql, viewDdl, masked };
  }
  return { ast, formattedSql, normalizedSql, raw: shown, rowCount, truncated, outcomes, stages };
}
