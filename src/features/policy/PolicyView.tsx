import { Button, Input, MessageBar, MessageBarBody, MessageBarTitle, Spinner, Textarea } from '@fluentui/react-components';
import { Checkmark24Regular, Dismiss24Regular, DocumentEdit24Regular, Sparkle24Regular, Beaker24Regular, ArrowUndo24Regular, Save24Regular } from '@fluentui/react-icons';
import type { Diagnostic } from '@codemirror/lint';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../../shared/api/errors';
import { api } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import type { GoldenDiffRow, PolicyData } from '../../shared/api/types';
import { lineDiff, diffStats } from '../../shared/engine/diff';
import { applyMask, TokenVault } from '../../shared/engine/masking';
import { resolveMask, ruleMatrix, validatePolicy, type CopilotResult, type Policy, type PolicyIssue } from '../../shared/engine/policy';
import { ROLES, TAGS, type Family, type Tag } from '../../shared/engine/types';
import { CodeEditor } from '../../shared/ui/CodeEditor';
import { Chip } from '../../shared/ui/Chips';
import { fmtTime, roleLabel } from '../../shared/ui/format';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { Skel } from '../../shared/ui/Skeleton';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { navigate, useRole } from '../../app/router';
import { usePolicy } from '../../app/queries';

const EXAMPLES: Record<Tag, { label: string; value: string; family: Family }> = {
  PII_HIGH: { label: 'Card number', value: '4111-1111-1111-1111', family: 'PAN' },
  FINANCIAL_CONFIDENTIAL: { label: 'Balance', value: '128450.00', family: 'BALANCE' },
  PII_MEDIUM: { label: 'Email', value: 'aarav.mehta@example.in', family: 'EMAIL' },
};
const vault = new TokenVault('policy-studio-illustration');

function toDiagnostics(text: string, issues: PolicyIssue[]): Diagnostic[] {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  return issues.map((i) => {
    const li = Math.min(lines.length, Math.max(1, i.line)) - 1;
    const from = (offsets[li] ?? 0) + Math.max(0, i.col - 1);
    const lineEnd = (offsets[li] ?? 0) + (lines[li]?.length ?? 0);
    const to = Math.min(lineEnd, Math.max(from + 1, (offsets[li] ?? 0) + Math.max(0, i.endCol - 1)));
    return { from: Math.min(from, lineEnd), to: Math.max(Math.min(from, lineEnd) + (lineEnd > from ? 1 : 0), to), severity: i.severity, message: `${i.code}: ${i.message}`, source: 'SmartMask' };
  });
}

function Matrix({ policy, base }: { policy: Policy; base: Policy }) {
  const cur = ruleMatrix(policy);
  const old = ruleMatrix(base);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => {
    void vault.prime(TAGS.map((t) => [t, EXAMPLES[t].value] as const)).then(() => setTokens({ ready: '1' }));
  }, []);
  const show = (role: (typeof ROLES)[number], tag: Tag): string => {
    const ex = EXAMPLES[tag];
    const r = resolveMask(policy, role, tag, ex.family);
    const out = applyMask(r.fn, ex.value, r.args, { tag, family: ex.family, vault });
    return tokens.ready || r.fn !== 'HMAC_TOKEN' ? String(out) : '…';
  };
  return (
    <div>
      <table className="sm-matrix fixed" aria-label="Rule matrix: roles by tags">
        <thead>
          <tr>
            <th scope="col">Role</th>
            {TAGS.map((t) => <th key={t} scope="col">{t}<div className="t-caption2 t-tertiary" style={{ fontWeight: 400 }}>e.g. {EXAMPLES[t].label}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => (
            <tr key={r}>
              <th scope="row">{roleLabel(r)}</th>
              {TAGS.map((t) => {
                const c = cur[r][t];
                const changed = c.fn !== old[r][t].fn || JSON.stringify(c.extras) !== JSON.stringify(old[r][t].extras);
                return (
                  <td key={t} data-changed={changed} aria-label={`${roleLabel(r)} ${t}: ${c.fn}${changed ? ' (changed)' : ''}`}>
                    <div className="sm-mono" style={{ fontWeight: 600 }}>{c.fn}</div>
                    {c.extras.map((x) => <div key={x.family} className="t-caption1 t-secondary sm-mono">{x.family} → {x.fn}</div>)}
                    <div className="sm-mono t-caption1" style={{ marginTop: 4, color: 'var(--sm-fg-tertiary)' }}>{show(r, t)}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoldenTable({ rows }: { rows: GoldenDiffRow[] }) {
  const changed = rows.filter((r) => r.changedCells > 0 || r.note.includes('→') && !r.note.startsWith('ok → ok'));
  return (
    <div className="sm-stack">
      <div className="t-body1s">Golden-query diff: {changed.length} of {rows.length} query × role outputs change</div>
      {changed.length === 0 ? (
        <p className="t-secondary" style={{ margin: 0 }}>All {rows.length} outputs are identical under the proposed policy.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="sm-matrix" aria-label="Golden query differences">
            <thead><tr><th scope="col">Query</th><th scope="col">Role</th><th scope="col">Cells changed</th><th scope="col">Before → after</th></tr></thead>
            <tbody>
              {changed.map((r) => (
                <tr key={`${r.queryId}-${r.role}`}>
                  <td>{r.title}</td>
                  <td>{roleLabel(r.role)}</td>
                  <td className="sm-num">{r.changedCells} / {r.totalCells}</td>
                  <td className="sm-mono t-caption1">{r.before ? `${r.before} → ${r.after}` : r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Studio({ data }: { data: PolicyData }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const role = useRole();
  const actor = DEFAULT_PRINCIPAL[role];
  const [text, setText] = useState(data.text);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [golden, setGolden] = useState<{ rows: GoldenDiffRow[]; for: string } | null>(null);
  const [goldenBusy, setGoldenBusy] = useState(false);
  const [ask, setAsk] = useState('');
  const [draft, setDraft] = useState<(CopilotResult & { request: string }) | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftGolden, setDraftGolden] = useState<GoldenDiffRow[] | null>(null);
  const lastValid = useRef<Policy>(data.policy);

  useEffect(() => setText(data.text), [data.text, data.version]);

  const validation = useMemo(() => validatePolicy(text), [text]);
  if (validation.policy) lastValid.current = validation.policy;
  const errors = validation.issues.filter((i) => i.severity === 'error');
  const dirty = text !== data.text;
  const canSave = errors.length === 0 && dirty && !saving;

  useExportProvider(() => ({
    name: `policy-v${data.version}`,
    rows: data.policy.rules.map((r) => ({ role: r.role, tag: r.tag, family: r.family ?? '', function: r.function, width: r.width ?? '' })),
    summary: { policy_version: data.version, history: data.history },
  }));

  const save = async (body: string, reason: string): Promise<void> => {
    setSaving(true);
    try {
      const { version } = await api.savePolicy(body, actor, reason);
      await qc.invalidateQueries();
      notify({ title: `Policy v${version} published`, body: 'Plan cache invalidated: the hit ratio will dip, then recover.' });
      setNote('');
      setGolden(null);
    } catch (e) {
      const d = describeError(e);
      notify({ title: `Could not publish (${d.code})`, body: d.message, intent: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const runGolden = async (body: string): Promise<GoldenDiffRow[]> => api.goldenDiff(body);

  const askCopilot = async (request: string): Promise<void> => {
    setDrafting(true);
    setDraft(null);
    setDraftGolden(null);
    try {
      const r = await api.copilot(request);
      setDraft({ ...r, request });
      if (r.kind === 'ok') {
        const v = validatePolicy(r.text);
        if (v.policy) setDraftGolden(await runGolden(r.text));
      }
    } catch (e) {
      notify({ title: 'Copilot unavailable', body: describeError(e).message, intent: 'error' });
    } finally {
      setDrafting(false);
    }
  };

  const draftValidation = draft?.kind === 'ok' ? validatePolicy(draft.text) : null;
  const draftErrors = draftValidation?.issues.filter((i) => i.severity === 'error') ?? [];
  const diff = draft?.kind === 'ok' ? lineDiff(data.text, draft.text) : [];
  const stats = diffStats(diff);

  return (
    <div className="sm-stack" style={{ gap: 16 }}>
      <div className="sm-split" style={{ alignItems: 'start' }}>
        <section className="sm-card sm-stack" aria-labelledby="yaml-h">
          <div className="sm-card-head" style={{ marginBottom: 0 }}>
            <h2 id="yaml-h" className="t-subtitle1" style={{ margin: 0 }}>policy.yaml</h2>
            <div className="sm-row">
              <Chip tone="brand">policy_version {data.version}</Chip>
              {dirty && <Chip tone="warn">Unsaved changes</Chip>}
              {errors.length > 0 ? <Chip tone="bad">{errors.length} error{errors.length > 1 ? 's' : ''}</Chip> : <Chip tone="ok">Valid</Chip>}
            </div>
          </div>
          <CodeEditor value={text} onChange={setText} language="yaml" ariaLabel="Policy YAML editor" height={430} diagnostics={(t) => toDiagnostics(t, validatePolicy(t).issues)} />
          {validation.issues.length > 0 && (
            <ul aria-label="Validation issues" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              {validation.issues.slice(0, 6).map((i, k) => (
                <li key={k}>
                  <MessageBar intent={i.severity === 'error' ? 'error' : 'warning'} layout="multiline">
                    <MessageBarBody><MessageBarTitle>Line {i.line} · {i.code}</MessageBarTitle>{i.message}</MessageBarBody>
                  </MessageBar>
                </li>
              ))}
            </ul>
          )}
          <div className="sm-row">
            <Input aria-label="Change note" placeholder="Change note (optional)" value={note} onChange={(_, d) => setNote(d.value)} style={{ flex: 1, minWidth: 180 }} />
            <Button appearance="primary" icon={saving ? <Spinner size="tiny" /> : <Save24Regular />} disabled={!canSave} onClick={() => void save(text, note)}>
              Save as v{data.version + 1}
            </Button>
            <Button icon={<ArrowUndo24Regular />} disabled={!dirty} onClick={() => setText(data.text)}>Revert</Button>
            <Button
              icon={goldenBusy ? <Spinner size="tiny" /> : <Beaker24Regular />}
              disabled={errors.length > 0 || !dirty || goldenBusy}
              onClick={async () => { setGoldenBusy(true); try { setGolden({ rows: await runGolden(text), for: text }); } finally { setGoldenBusy(false); } }}
            >
              Preview impact
            </Button>
          </div>
          {golden && golden.for === text && <GoldenTable rows={golden.rows} />}
        </section>

        <section className="sm-card sm-stack" aria-labelledby="matrix-h">
          <div className="sm-card-head" style={{ marginBottom: 0 }}>
            <h2 id="matrix-h" className="t-subtitle1" style={{ margin: 0 }}>Live rule matrix</h2>
            <span className="t-caption1 t-tertiary">{dirty ? (errors.length ? 'showing last valid draft' : 'draft, highlighted cells differ from v' + data.version) : 'matches published policy'}</span>
          </div>
          <Matrix policy={lastValid.current} base={data.policy} />
          <p className="t-caption1 t-secondary" style={{ margin: 0 }}>
            Cells show the function that applies; the grey line is an illustrative output for a sample {Object.values(EXAMPLES).map((e) => e.label.toLowerCase()).join(' / ')}. Specific rules beat generic ones; no rule means fail-closed REDACT.
          </p>
        </section>
      </div>

      <section className="sm-card sm-stack" aria-labelledby="copilot-h">
        <div className="sm-card-head" style={{ marginBottom: 0 }}>
          <h2 id="copilot-h" className="t-subtitle1" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Sparkle24Regular aria-hidden /> Policy Copilot</h2>
          <Chip tone="brand">Drafts only · never on the query path</Chip>
        </div>
        <div className="sm-row" style={{ alignItems: 'flex-end' }}>
          <Textarea aria-label="Describe the policy change" value={ask} onChange={(_, d) => setAsk(d.value)} placeholder="e.g. Redact balances for support" rows={2} resize="vertical" style={{ flex: 1, minWidth: 240 }} />
          <Button appearance="primary" disabled={!ask.trim() || drafting} icon={drafting ? <Spinner size="tiny" /> : <Sparkle24Regular />} onClick={() => void askCopilot(ask.trim())}>Draft change</Button>
        </div>
        <div className="sm-row" aria-label="Example requests">
          {['Redact balances for support', 'Tokenise email addresses for analysts', 'Bucket balances in 25,000 bands for support', 'Let support see full card numbers'].map((s) => (
            <Button key={s} size="small" appearance="outline" onClick={() => { setAsk(s); void askCopilot(s); }}>{s}</Button>
          ))}
        </div>
        {drafting && <div className="sm-stack" role="status" aria-label="Drafting"><Skel w="60%" h={14} /><Skel h={90} /></div>}
        {draft?.kind === 'unclear' && <MessageBar intent="info"><MessageBarBody>{draft.message}</MessageBarBody></MessageBar>}
        {draft?.kind === 'ok' && (
          <div className="sm-stack" aria-live="polite">
            <div><strong>Proposed:</strong> {draft.summary}</div>
            <div className="sm-diff" role="region" aria-label="YAML diff" tabIndex={0} style={{ maxHeight: 220 }}>
              {diff.filter((l) => l.type !== 'same' || true).map((l, i, arr) => {
                const near = l.type !== 'same' || arr.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== 'same');
                return near ? <div key={i} className={l.type === 'same' ? '' : l.type}>{l.text || ' '}</div> : null;
              })}
            </div>
            <div className="sm-row">
              <Chip tone="ok">+{stats.added}</Chip><Chip tone="bad">−{stats.removed}</Chip>
              {draftErrors.length === 0 ? <Chip tone="ok">Validates</Chip> : <Chip tone="bad">Blocked by guardrail</Chip>}
            </div>
            {draftErrors.map((i, k) => (
              <MessageBar key={k} intent="error"><MessageBarBody><MessageBarTitle>{i.code}</MessageBarTitle>{i.message}</MessageBarBody></MessageBar>
            ))}
            {draftGolden && <GoldenTable rows={draftGolden} />}
            <div className="sm-row">
              <Button
                appearance="primary"
                icon={<Checkmark24Regular />}
                disabled={draftErrors.length > 0 || saving}
                onClick={async () => { await save(draft.text, `Copilot draft approved: “${draft.request}”`); setDraft(null); setAsk(''); }}
              >
                Approve and publish
              </Button>
              <Button icon={<Dismiss24Regular />} onClick={() => { setDraft(null); setDraftGolden(null); }}>Discard</Button>
            </div>
          </div>
        )}
      </section>

      <section className="sm-card" aria-labelledby="hist-h">
        <h2 id="hist-h" className="t-subtitle1" style={{ marginTop: 0 }}>Version history</h2>
        <ol className="sm-timeline" reversed>
          {[...data.history].reverse().map((h) => (
            <li key={h.version} data-tone={h.version === data.version ? 'ok' : undefined}>
              <div className="t-body1s">v{h.version}{h.version === data.version ? ' · live' : ''}</div>
              <div className="t-caption1 t-tertiary">{fmtTime(h.at)} · {h.author}</div>
              <div>{h.reason}</div>
            </li>
          ))}
        </ol>
        <Button size="small" onClick={() => navigate('performance')}>See the cache effect in Performance</Button>
      </section>
    </div>
  );
}

function StudioSkeleton() {
  return (
    <div className="sm-split" role="status" aria-busy="true" aria-label="Loading policy">
      <div className="sm-card" style={{ height: 600 }}><Skel w="30%" h={16} /><div style={{ height: 12 }} /><Skel h={430} /></div>
      <div className="sm-card" style={{ height: 600 }}><Skel w="40%" h={16} /><div style={{ height: 12 }} /><Skel h={300} /></div>
    </div>
  );
}

export default function PolicyView() {
  const q = usePolicy();
  const m = useLoadMachine(q, (d) => d.policy.rules.length === 0);
  return (
    <ViewFrame title="Policy Studio" icon={<DocumentEdit24Regular />} subtitle="Edit the masking policy as YAML. Validation, the rule matrix and a golden-query diff run before anything goes live.">
      <Region machine={m} skeleton={<StudioSkeleton />} empty={<EmptyPanel title="No policy rules">The policy has no rules; every non-admin read would be fail-closed REDACT.</EmptyPanel>}>
        {q.data && <Studio data={q.data} />}
      </Region>
    </ViewFrame>
  );
}
