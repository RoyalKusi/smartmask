import { DEFAULT_BUCKET_WIDTH, partialProfile, type MaskArgs, type MaskFn } from './masking';
import { ROLES, TAGS, type Family, type Role, type Tag } from './types';

export interface PolicyRule {
  role: Role;
  tag: Tag | '*';
  family?: Family;
  function: MaskFn;
  width?: number;
  keep_first?: number;
  keep_last?: number;
  line: number;
}

export interface Policy {
  version: number;
  rules: PolicyRule[];
}

export interface PolicyIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  line: number;
  col: number;
  endCol: number;
}

export interface ResolvedMask {
  fn: MaskFn;
  args: MaskArgs;
  rule: PolicyRule | null;
}

/** Most specific rule wins: family-specific beats generic, explicit tag beats "*". No rule fails closed. */
export function resolveMask(policy: Policy, role: Role, tag: Tag, family?: Family): ResolvedMask {
  let best: PolicyRule | null = null;
  let bestScore = -1;
  for (const r of policy.rules) {
    if (r.role !== role) continue;
    if (r.tag !== '*' && r.tag !== tag) continue;
    if (r.family && r.family !== family) continue;
    const score = (r.family ? 2 : 0) + (r.tag !== '*' ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (!best) return { fn: role === 'ROLE_ADMIN' ? 'PLAINTEXT' : 'REDACT', args: {}, rule: null };
  const args: MaskArgs = {};
  if (best.function === 'BUCKET') args.width = best.width ?? DEFAULT_BUCKET_WIDTH;
  if (best.keep_first !== undefined) args.keep_first = best.keep_first;
  if (best.keep_last !== undefined) args.keep_last = best.keep_last;
  if (best.function === 'PARTIAL_KEEP' && args.keep_first === undefined && args.keep_last === undefined) {
    const p = partialProfile(family);
    args.keep_first = p.first;
    args.keep_last = p.last;
  }
  return { fn: best.function, args, rule: best };
}

export interface MatrixCell {
  fn: MaskFn;
  extras: { family: Family; fn: MaskFn }[];
}

export function ruleMatrix(policy: Policy): Record<Role, Record<Tag, MatrixCell>> {
  const out = {} as Record<Role, Record<Tag, MatrixCell>>;
  for (const r of ROLES) {
    out[r] = {} as Record<Tag, MatrixCell>;
    for (const t of TAGS) {
      const main = resolveMask(policy, r, t);
      out[r][t] = {
        fn: main.fn,
        extras: policy.rules
          .filter((x) => x.role === r && x.family && (x.tag === t || x.tag === '*'))
          .map((x) => ({ family: x.family as Family, fn: x.function })),
      };
    }
  }
  return out;
}

export function withVersion(text: string, version: number): string {
  return /^policy_version:.*$/m.test(text)
    ? text.replace(/^policy_version:.*$/m, `policy_version: ${version}`)
    : `policy_version: ${version}\n${text}`;
}
