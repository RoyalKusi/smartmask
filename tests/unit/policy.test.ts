import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff } from '../../src/shared/engine/diff';
import { DEFAULT_POLICY } from '../../src/shared/engine/defaultPolicy';
import { DEFAULT_POLICY_YAML, copilotDraft, parsePolicy, resolveMask, ruleMatrix, withVersion } from '../../src/shared/engine/policy';

const strip = (p: { rules: { line?: number }[] }) => p.rules.map(({ line: _l, ...r }) => r);

describe('policy', () => {
  it('the pre-parsed default policy equals the parsed YAML', () => {
    const parsed = parsePolicy(DEFAULT_POLICY_YAML).policy!;
    expect(parsed.version).toBe(DEFAULT_POLICY.version);
    expect(strip(parsed)).toEqual(strip(DEFAULT_POLICY));
  });

  it('resolves the most specific rule: family beats generic, explicit tag beats wildcard', () => {
    const p = DEFAULT_POLICY;
    expect(resolveMask(p, 'ROLE_ADMIN', 'PII_HIGH').fn).toBe('PLAINTEXT');
    expect(resolveMask(p, 'ROLE_SUPPORT', 'PII_MEDIUM', 'EMAIL').fn).toBe('PARTIAL_EMAIL');
    expect(resolveMask(p, 'ROLE_SUPPORT', 'PII_MEDIUM', 'PHONE').fn).toBe('PARTIAL_KEEP');
    expect(resolveMask(p, 'ROLE_SUPPORT', 'FINANCIAL_CONFIDENTIAL').args.width).toBe(50000);
    expect(resolveMask(p, 'ROLE_ANALYST', 'PII_HIGH').fn).toBe('HMAC_TOKEN');
    expect(resolveMask(p, 'ROLE_ANALYST', 'FINANCIAL_CONFIDENTIAL').fn).toBe('REDACT');
  });

  it('with no matching rule the engine fails closed for non-admin roles', () => {
    expect(resolveMask({ version: 1, rules: [] }, 'ROLE_SUPPORT', 'PII_HIGH').fn).toBe('REDACT');
  });

  it('reports YAML syntax errors with the line number', () => {
    const r = parsePolicy(`${DEFAULT_POLICY_YAML}\n- stray`);
    expect(r.policy).toBeNull();
    expect(r.issues[0]!.code).toBe('SM-POL-001');
    expect(r.issues[0]!.line).toBeGreaterThan(20);
  });

  it('validates roles, tags, functions, widths and duplicates', () => {
    const bad = (rule: string) => parsePolicy(DEFAULT_POLICY_YAML.replace('rules:\n', `rules:\n${rule}`)).issues.filter((i) => i.severity === 'error');
    expect(bad('  - { role: ROLE_X, tag: PII_HIGH, function: REDACT }\n').map((i) => i.code)).toContain('SM-POL-002');
    expect(bad('  - { role: ROLE_ANALYST, tag: PII_HIGH, function: SHRED }\n').map((i) => i.code)).toContain('SM-POL-002');
    expect(bad('  - { role: ROLE_ANALYST, tag: FINANCIAL_CONFIDENTIAL, function: BUCKET, width: -5 }\n').map((i) => i.code)).toContain('SM-POL-004');
    expect(bad('  - { role: ROLE_ANALYST, tag: PII_HIGH, function: REDACT }\n').map((i) => i.code)).toContain('SM-POL-005');
  });

  it('guardrail: non-admin PLAINTEXT on PII_HIGH is refused (SM-POL-003)', () => {
    const text = DEFAULT_POLICY_YAML.replace('tag: PII_HIGH\n    function: PARTIAL_KEEP', 'tag: PII_HIGH\n    function: PLAINTEXT');
    const r = parsePolicy(text);
    expect(r.policy).toBeNull();
    expect(r.issues.some((i) => i.code === 'SM-POL-003')).toBe(true);
  });

  it('coverage: removing a role/tag rule is flagged because it would fail closed', () => {
    const text = DEFAULT_POLICY_YAML.replace(/ {2}- role: ROLE_ANALYST\n {4}tag: PII_MEDIUM\n {4}function: REDACT\n/, '');
    expect(parsePolicy(text).issues.some((i) => i.code === 'SM-POL-006')).toBe(true);
  });

  it('rule matrix reflects the policy and withVersion rewrites only the version line', () => {
    const m = ruleMatrix(DEFAULT_POLICY);
    expect(m.ROLE_SUPPORT.PII_HIGH.fn).toBe('PARTIAL_KEEP');
    expect(m.ROLE_SUPPORT.PII_MEDIUM.extras).toEqual([{ family: 'EMAIL', fn: 'PARTIAL_EMAIL' }]);
    const v8 = withVersion(DEFAULT_POLICY_YAML, 8);
    expect(parsePolicy(v8).policy!.version).toBe(8);
    expect(lineDiff(DEFAULT_POLICY_YAML, v8).filter((l) => l.type !== 'same')).toHaveLength(2);
  });
});

describe('copilot (drafts only)', () => {
  it('turns a plain-language request into a YAML change that validates', () => {
    const r = copilotDraft('Redact balances for support', DEFAULT_POLICY_YAML);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.changes).toEqual([{ role: 'ROLE_SUPPORT', tag: 'FINANCIAL_CONFIDENTIAL', fn: 'REDACT' }]);
    const p = parsePolicy(r.text);
    expect(p.policy).not.toBeNull();
    expect(resolveMask(p.policy!, 'ROLE_SUPPORT', 'FINANCIAL_CONFIDENTIAL').fn).toBe('REDACT');
    const stats = diffStats(lineDiff(DEFAULT_POLICY_YAML, r.text));
    expect(stats.added + stats.removed).toBeLessThanOrEqual(4);
  });

  it('adds a family-specific rule for email requests', () => {
    const r = copilotDraft('Tokenise email addresses for analysts', DEFAULT_POLICY_YAML);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    const p = parsePolicy(r.text).policy!;
    expect(resolveMask(p, 'ROLE_ANALYST', 'PII_MEDIUM', 'EMAIL').fn).toBe('HMAC_TOKEN');
    expect(resolveMask(p, 'ROLE_ANALYST', 'PII_MEDIUM', 'PHONE').fn).toBe('REDACT');
  });

  it('parses a bucket width', () => {
    const r = copilotDraft('Bucket balances in 25,000 bands for support', DEFAULT_POLICY_YAML);
    expect(r.kind === 'ok' && resolveMask(parsePolicy(r.text).policy!, 'ROLE_SUPPORT', 'FINANCIAL_CONFIDENTIAL').args.width).toBe(25000);
  });

  it('a request that would weaken PII_HIGH produces a draft the validator rejects', () => {
    const r = copilotDraft('Let support see full card numbers', DEFAULT_POLICY_YAML);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(parsePolicy(r.text).issues.some((i) => i.code === 'SM-POL-003')).toBe(true);
  });

  it('asks for clarification instead of guessing', () => {
    expect(copilotDraft('make it better', DEFAULT_POLICY_YAML).kind).toBe('unclear');
  });
});
