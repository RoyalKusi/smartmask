import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Document, type Node, type YAMLMap } from 'yaml';
import { MASK_FNS, DEFAULT_BUCKET_WIDTH, partialProfile, type MaskArgs, type MaskFn } from './masking';
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

export const DEFAULT_POLICY_YAML = `# SmartMask masking policy.
# Roles x tags -> masking function. Save publishes a new policy_version.
policy_version: 7
fail_mode: closed
rules:
  - role: ROLE_ADMIN
    tag: "*"
    function: PLAINTEXT
  - role: ROLE_SUPPORT
    tag: PII_HIGH
    function: PARTIAL_KEEP
  - role: ROLE_SUPPORT
    tag: FINANCIAL_CONFIDENTIAL
    function: BUCKET
    width: 50000
  - role: ROLE_SUPPORT
    tag: PII_MEDIUM
    function: PARTIAL_KEEP
  - role: ROLE_SUPPORT
    tag: PII_MEDIUM
    family: EMAIL
    function: PARTIAL_EMAIL
  - role: ROLE_ANALYST
    tag: PII_HIGH
    function: HMAC_TOKEN
  - role: ROLE_ANALYST
    tag: FINANCIAL_CONFIDENTIAL
    function: REDACT
  - role: ROLE_ANALYST
    tag: PII_MEDIUM
    function: REDACT
`;

const FAMILIES: readonly string[] = [
  'PAN', 'SSN', 'AADHAAR', 'IBAN', 'ACCOUNT_NO', 'EMAIL', 'PHONE', 'PERSON_NAME', 'DOB', 'ADDRESS',
  'BALANCE', 'AMOUNT', 'SALARY', 'FREE_TEXT', 'OTHER',
];
const RULE_KEYS = ['role', 'tag', 'family', 'function', 'width', 'keep_first', 'keep_last'];

export interface ParsedPolicy {
  policy: Policy | null;
  issues: PolicyIssue[];
}

interface Located {
  doc: Document.Parsed;
  lc: LineCounter;
}

function locate(lc: LineCounter, node: Node | null | undefined, fallbackLine = 1): Pick<PolicyIssue, 'line' | 'col' | 'endCol'> {
  const range = node?.range;
  if (!range) return { line: fallbackLine, col: 1, endCol: 2 };
  const start = lc.linePos(range[0]);
  const end = lc.linePos(Math.max(range[0], range[1] - 1));
  return { line: start.line, col: start.col, endCol: end.line === start.line ? end.col + 1 : start.col + 1 };
}

export function parsePolicy(text: string): ParsedPolicy {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false });
  const issues: PolicyIssue[] = [];
  for (const e of doc.errors) {
    const p = e.linePos?.[0];
    issues.push({
      code: 'SM-POL-001',
      message: e.message.split('\n')[0] ?? e.message,
      severity: 'error',
      line: p?.line ?? 1,
      col: p?.col ?? 1,
      endCol: (e.linePos?.[1]?.col ?? (p?.col ?? 1) + 1),
    });
  }
  if (issues.length) return { policy: null, issues };

  const ctx: Located = { doc, lc };
  const root = doc.contents;
  if (!isMap(root)) {
    issues.push({ code: 'SM-POL-001', message: 'Policy must be a mapping with policy_version and rules.', severity: 'error', line: 1, col: 1, endCol: 2 });
    return { policy: null, issues };
  }
  const at = (node: unknown): Pick<PolicyIssue, 'line' | 'col' | 'endCol'> => locate(ctx.lc, node as Node);
  const err = (code: string, message: string, node: unknown, severity: PolicyIssue['severity'] = 'error'): void => {
    issues.push({ code, message, severity, ...at(node) });
  };

  const versionNode = root.get('policy_version', true) as Node | undefined;
  const versionValue: unknown = isScalar(versionNode) ? versionNode.value : undefined;
  let version = 0;
  if (typeof versionValue !== 'number' || !Number.isInteger(versionValue) || versionValue < 1) {
    err('SM-POL-002', 'policy_version must be a positive integer.', versionNode ?? root);
  } else version = versionValue;

  const failMode = root.get('fail_mode', true) as Node | undefined;
  if (failMode && (!isScalar(failMode) || failMode.value !== 'closed')) {
    err('SM-POL-002', 'fail_mode must be "closed": SmartMask never fails open.', failMode);
  }
  for (const pair of root.items) {
    const k = isScalar(pair.key) ? String(pair.key.value) : '';
    if (!['policy_version', 'fail_mode', 'rules'].includes(k)) err('SM-POL-002', `Unknown top-level key "${k}".`, pair.key, 'warning');
  }

  const rulesNode = root.get('rules', true);
  const rules: PolicyRule[] = [];
  if (!isSeq(rulesNode) || rulesNode.items.length === 0) {
    err('SM-POL-002', 'rules must be a non-empty list.', rulesNode ?? root);
    return { policy: null, issues };
  }

  const seen = new Map<string, number>();
  for (const item of rulesNode.items) {
    if (!isMap(item)) {
      err('SM-POL-002', 'Each rule must be a mapping.', item as Node);
      continue;
    }
    const m = item as YAMLMap;
    const get = (k: string): { node: Node | null; value: unknown } => {
      const n = m.get(k, true) as Node | undefined;
      return { node: n ?? null, value: isScalar(n) ? n.value : undefined };
    };
    for (const pair of m.items) {
      const k = isScalar(pair.key) ? String(pair.key.value) : '';
      if (!RULE_KEYS.includes(k)) err('SM-POL-002', `Unknown rule key "${k}".`, pair.key);
    }
    const role = get('role');
    const tag = get('tag');
    const fam = get('family');
    const fn = get('function');
    let ok = true;
    if (!ROLES.includes(role.value as Role)) { err('SM-POL-002', `role must be one of ${ROLES.join(', ')}.`, role.node ?? m); ok = false; }
    if (tag.value !== '*' && !TAGS.includes(tag.value as Tag)) { err('SM-POL-002', `tag must be one of ${TAGS.join(', ')} or "*".`, tag.node ?? m); ok = false; }
    if (!MASK_FNS.includes(fn.value as MaskFn)) { err('SM-POL-002', `function must be one of ${MASK_FNS.join(', ')}.`, fn.node ?? m); ok = false; }
    if (fam.node && !FAMILIES.includes(fam.value as string)) { err('SM-POL-002', `family must be one of ${FAMILIES.join(', ')}.`, fam.node); ok = false; }
    const width = get('width');
    if (width.node && (!Number.isInteger(width.value) || (width.value as number) <= 0)) { err('SM-POL-004', 'width must be a positive integer.', width.node); ok = false; }
    if (width.node && fn.value !== 'BUCKET') { err('SM-POL-004', 'width only applies to BUCKET.', width.node); ok = false; }
    for (const kk of ['keep_first', 'keep_last']) {
      const g = get(kk);
      if (g.node && (!Number.isInteger(g.value) || (g.value as number) < 0)) { err('SM-POL-004', `${kk} must be a non-negative integer.`, g.node); ok = false; }
    }
    if (!ok) continue;

    const r = role.value as Role;
    const t = tag.value as Tag | '*';
    const f = fam.node ? (fam.value as Family) : undefined;
    const func = fn.value as MaskFn;
    if (r !== 'ROLE_ADMIN' && func === 'PLAINTEXT' && (t === 'PII_HIGH' || t === '*')) {
      err('SM-POL-003', `Guardrail: ${r} may never receive PLAINTEXT for ${t === '*' ? 'any tag' : 'PII_HIGH'}.`, fn.node);
    }
    if (func === 'BUCKET' && t !== 'FINANCIAL_CONFIDENTIAL') {
      err('SM-POL-004', 'BUCKET applies to numeric FINANCIAL_CONFIDENTIAL values only.', fn.node);
    }
    if (func === 'PARTIAL_EMAIL' && f !== 'EMAIL') {
      err('SM-POL-004', 'PARTIAL_EMAIL requires family: EMAIL.', fn.node);
    }
    const key = `${r}|${t}|${f ?? ''}`;
    if (seen.has(key)) err('SM-POL-005', `Duplicate rule for ${r} / ${t}${f ? ` / ${f}` : ''} (first defined on line ${seen.get(key)}).`, m);
    const startLine = at(m).line;
    seen.set(key, startLine);

    const rule: PolicyRule = { role: r, tag: t, function: func, line: startLine };
    if (f) rule.family = f;
    if (typeof width.value === 'number') rule.width = width.value;
    const kf = get('keep_first').value;
    const kl = get('keep_last').value;
    if (typeof kf === 'number') rule.keep_first = kf;
    if (typeof kl === 'number') rule.keep_last = kl;
    rules.push(rule);
  }

  if (!issues.some((i) => i.severity === 'error')) {
    for (const r of ROLES) {
      for (const t of TAGS) {
        const covered = rules.some((x) => x.role === r && !x.family && (x.tag === t || x.tag === '*'));
        if (!covered) err('SM-POL-006', `No rule covers ${r} / ${t}; the engine would fail closed. Add an explicit rule.`, rulesNode);
      }
    }
  }
  if (issues.some((i) => i.severity === 'error')) return { policy: null, issues };
  return { policy: { version, rules }, issues };
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

export interface CopilotChange {
  role: Role;
  tag: Tag;
  family?: Family;
  fn: MaskFn;
}

export type CopilotResult =
  | { kind: 'ok'; summary: string; changes: CopilotChange[]; text: string }
  | { kind: 'unclear'; message: string };

const ROLE_WORDS: [Role, RegExp][] = [
  ['ROLE_ADMIN', /\badmins?\b|administrators?/i],
  ['ROLE_SUPPORT', /\bsupport\b|help ?desk|\bagents?\b/i],
  ['ROLE_ANALYST', /analysts?|analytics|data scien/i],
];

function parseTargets(req: string): { tag: Tag; family?: Family }[] {
  const out: { tag: Tag; family?: Family }[] = [];
  if (/e-?mail/i.test(req)) out.push({ tag: 'PII_MEDIUM', family: 'EMAIL' });
  if (/card|\bpan\b|ssn|aadhaar|iban|account number|pii[_ ]?high|high[- ]risk|identifier/i.test(req)) out.push({ tag: 'PII_HIGH' });
  if (/balance|financial|salary|income|amount|loan|money/i.test(req)) out.push({ tag: 'FINANCIAL_CONFIDENTIAL' });
  if (/pii[_ ]?medium|medium|\bnames?\b|phone|address|contact|birth|dob/i.test(req)) out.push({ tag: 'PII_MEDIUM' });
  return out;
}

function parseFunction(req: string, family?: Family): MaskFn | null {
  if (/bucket|range|banded?|band\b/i.test(req)) return 'BUCKET';
  if (/token|hash|pseudonym|hmac/i.test(req)) return 'HMAC_TOKEN';
  if (/redact|hide|blank|fully mask|remove|block/i.test(req)) return 'REDACT';
  if (/partial|last (4|four)|first (1|one|4|four)|truncate/i.test(req)) return family === 'EMAIL' ? 'PARTIAL_EMAIL' : 'PARTIAL_KEEP';
  if (/plain ?text|unmask|\bshow\b|reveal|\bfull\b|in the clear|raw/i.test(req)) return 'PLAINTEXT';
  return null;
}

/** Deterministic request-to-YAML drafter. Drafts only: a human approves, and it never runs on the query path. */
export function copilotDraft(request: string, currentText: string): CopilotResult {
  const roles = ROLE_WORDS.filter(([, re]) => re.test(request)).map(([r]) => r);
  const targets = parseTargets(request);
  if (!roles.length || !targets.length) {
    return {
      kind: 'unclear',
      message:
        'I could not map that to a role and a tag. Try: "Redact balances for support" or "Tokenise email addresses for analysts".',
    };
  }
  const doc = parseDocument(currentText);
  const seq = doc.get('rules', true);
  if (!isSeq(seq)) return { kind: 'unclear', message: 'The current policy has no rules list to edit; fix the YAML first.' };

  const changes: CopilotChange[] = [];
  for (const role of roles) {
    for (const target of targets) {
      const fn = parseFunction(request, target.family);
      if (!fn) {
        return { kind: 'unclear', message: 'Which masking function should apply: redact, token, partial, bucket or plaintext?' };
      }
      const idx = seq.items.findIndex((it) => {
        if (!isMap(it)) return false;
        return it.get('role') === role && it.get('tag') === target.tag && (it.get('family') ?? undefined) === target.family;
      });
      if (idx >= 0) {
        doc.setIn(['rules', idx, 'function'], fn);
        if (fn === 'BUCKET') {
          const w = /(\d[\d,]*)\s*(k\b)?/i.exec(request);
          const width = w ? Number((w[1] as string).replace(/,/g, '')) * (w[2] ? 1000 : 1) : DEFAULT_BUCKET_WIDTH;
          doc.setIn(['rules', idx, 'width'], width >= 1000 ? width : DEFAULT_BUCKET_WIDTH);
        } else doc.deleteIn(['rules', idx, 'width']);
      } else {
        const node: Record<string, unknown> = { role, tag: target.tag };
        if (target.family) node.family = target.family;
        node.function = fn;
        if (fn === 'BUCKET') node.width = DEFAULT_BUCKET_WIDTH;
        seq.add(doc.createNode(node));
      }
      changes.push({ role, tag: target.tag, ...(target.family ? { family: target.family } : {}), fn });
    }
  }
  const text = doc.toString();
  const summary = changes
    .map((c) => `${c.role} · ${c.tag}${c.family ? ` (${c.family})` : ''} → ${c.fn}`)
    .join('; ');
  return { kind: 'ok', summary, changes, text };
}
