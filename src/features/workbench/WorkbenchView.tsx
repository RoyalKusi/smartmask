import { Button, Dropdown, MessageBar, MessageBarBody, MessageBarTitle, Option, Tab, TabList } from '@fluentui/react-components';
import type { Diagnostic } from '@codemirror/lint';
import { Code24Regular, Play24Regular, ErrorCircle16Filled, CheckmarkCircle16Filled } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { describeError } from '../../shared/api/errors';
import { api } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import type { QueryRunResult } from '../../shared/api/types';
import { diffStats, lineDiff } from '../../shared/engine/diff';
import { QUERY_TRANSITIONS, transition, type QueryStage } from '../../shared/engine/fsm';
import { STAGE_BUDGET_MS, type RoleOutcome, type StageTimings } from '../../shared/engine/pipeline';
import { parseSql } from '../../shared/engine/sql/parser';
import { EngineError, VIOLATION_TITLES, type Value, type Violation } from '../../shared/engine/types';
import { BACKENDS } from '../../shared/data/schema';
import { Chip, RoleChip } from '../../shared/ui/Chips';
import { CodeEditor } from '../../shared/ui/CodeEditor';
import { DataTable, type Column } from '../../shared/ui/DataTable';
import { fmtInt, roleLabel } from '../../shared/ui/format';
import { MaskedText } from '../../shared/ui/MaskedText';
import { useNotify } from '../../shared/ui/Notify';
import { Skel } from '../../shared/ui/Skeleton';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useReducedMotion } from '../../shared/ui/useMedia';
import { useUi } from '../../app/store';
import { setParams, useParam, useRole } from '../../app/router';
import { SAMPLES } from './samples';

type StageKey = 'parse' | 'validate' | 'rewrite' | 'execute' | 'mask' | 'audit';
const STAGES: { key: StageKey; label: string; timing: keyof StageTimings; fsm: QueryStage }[] = [
  { key: 'parse', label: 'Parse', timing: 'parse', fsm: 'parse' },
  { key: 'validate', label: 'Validate · policy', timing: 'policy', fsm: 'validate' },
  { key: 'rewrite', label: 'Rewrite · mutation', timing: 'mutation', fsm: 'rewrite' },
  { key: 'execute', label: 'Execute · backend', timing: 'execute', fsm: 'execute' },
  { key: 'mask', label: 'Mask · render', timing: 'render', fsm: 'mask' },
  { key: 'audit', label: 'Audit', timing: 'audit', fsm: 'audit' },
];

const HINTS: Record<Violation['code'], string> = {
  'SM-PRED-001': 'Compare the tagged column to another column (a join) or filter on an untagged column instead. Admin may run literal predicates.',
  'SM-DERIVED-001': 'Select the tagged column directly so the engine can mask it, or ask an Admin to run the aggregate.',
  'SM-PARSE-001': 'Check keywords and punctuation. The tokenizer supports SELECT, aliases, joins, CTEs, subqueries and UNION.',
  'SM-AUDIT-001': 'Clear the “Audit queue full” switch in the chaos tools (Ctrl+Shift+E) to resume.',
  'SM-CAT-002': 'Check the table or column name against the backend you selected.',
};

function parseDiagnostics(sql: string): Diagnostic[] {
  if (!sql.trim()) return [];
  try {
    parseSql(sql);
    return [];
  } catch (e) {
    if (e instanceof EngineError) {
      const pos = Math.min(e.position ?? 0, sql.length);
      return [{ from: pos, to: Math.min(sql.length, pos + 1) > pos ? Math.min(sql.length, pos + 1) : pos, severity: 'error', message: `SM-PARSE-001: ${e.message}` }];
    }
    return [];
  }
}

function StageStrip({ states, timings, runRole, total, cacheHit }: { states: Record<StageKey, 'idle' | 'active' | 'done' | 'fail' | 'skipped'>; timings: StageTimings | null; runRole: string | null; total: number | null; cacheHit: boolean | null }) {
  const overhead = timings?.overhead ?? 0;
  const parts: { k: string; v: number; c: string }[] = timings
    ? [
        { k: 'parse', v: timings.parse, c: 'var(--sm-brand)' },
        { k: 'policy', v: timings.policy, c: 'var(--sm-tag-financial)' },
        { k: 'mutation', v: timings.mutation, c: 'var(--sm-tag-pii-medium)' },
        { k: 'render', v: timings.render, c: 'var(--sm-success)' },
        { k: 'audit', v: timings.audit, c: 'var(--sm-fg-tertiary)' },
      ]
    : [];
  const scale = Math.max(5, overhead * 1.15);
  return (
    <section className="sm-card sm-stack" aria-label="Pipeline stages and overhead budget" style={{ gap: 12 }}>
      <ol className="sm-stages" aria-label="Pipeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {STAGES.map((s) => {
          const st = states[s.key];
          return (
            <li key={s.key} className="sm-stage" data-state={st} aria-current={st === 'active' ? 'step' : undefined}>
              <div className="t-caption1 t-secondary" style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                <span>{s.label}</span>
                {st === 'done' && <CheckmarkCircle16Filled aria-label="done" style={{ color: 'var(--sm-success)' }} />}
                {st === 'fail' && <ErrorCircle16Filled aria-label="failed" style={{ color: 'var(--sm-danger)' }} />}
              </div>
              <div className="t-subtitle1 sm-num">{timings && (st === 'done' || st === 'fail') ? `${(timings[s.timing] as number).toFixed(s.key === 'execute' ? 0 : 2)} ms` : st === 'skipped' ? '—' : '·'}</div>
            </li>
          );
        })}
      </ol>
      <div>
        <div className="sm-row" style={{ justifyContent: 'space-between' }}>
          <span className="t-body1s">
            SmartMask overhead {timings ? <span className="sm-num">{overhead.toFixed(2)} ms</span> : '—'} <span className="t-secondary">of {STAGE_BUDGET_MS.toFixed(1)} ms budget</span>
          </span>
          <span className="sm-row">
            {cacheHit !== null && <Chip tone={cacheHit ? 'ok' : 'neutral'}>plan cache {cacheHit ? 'hit' : 'miss'}</Chip>}
            {runRole && <Chip tone="neutral">run as {runRole}</Chip>}
            <Chip tone="neutral">simulated timings</Chip>
          </span>
        </div>
        <div role="img" aria-label={timings ? `Overhead ${overhead.toFixed(2)} milliseconds against a ${STAGE_BUDGET_MS} millisecond budget` : 'No timings yet'} style={{ position: 'relative', height: 14, marginTop: 6, background: 'var(--sm-stroke-subtle)', borderRadius: 7, overflow: 'hidden', display: 'flex' }}>
          {parts.map((p) => <i key={p.k} title={`${p.k} ${p.v.toFixed(2)} ms`} style={{ width: `${(p.v / scale) * 100}%`, background: p.c, transition: 'width 300ms var(--sm-ease-in)' }} />)}
          <i aria-hidden style={{ position: 'absolute', left: `${(STAGE_BUDGET_MS / scale) * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--sm-danger)' }} />
        </div>
        <div className="sm-row t-caption1 t-secondary" style={{ marginTop: 4 }}>
          {parts.map((p) => <span key={p.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: p.c, display: 'inline-block' }} />{p.k} {p.v.toFixed(2)}</span>)}
          <span>· backend execution {timings ? timings.execute.toFixed(0) : '—'} ms is not overhead{total ? ` · round trip ${total} ms` : ''}</span>
        </div>
      </div>
    </section>
  );
}

function ResultGrid({ columns, rows, masked, ariaLabel, truncated, total }: { columns: string[]; rows: readonly (readonly Value[])[]; masked: boolean; ariaLabel: string; truncated: boolean; total: number }) {
  const density = useUi((s) => s.density);
  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(null);
  type R = { i: number; v: readonly Value[] };
  const data = useMemo<R[]>(() => rows.map((v, i) => ({ i, v })), [rows]);
  const cols = useMemo<Column<R>[]>(
    () => columns.map((name, ci) => ({
      id: `c${ci}`,
      header: name,
      width: Math.max(110, Math.min(260, 40 + name.length * 9)),
      sortValue: (r: R) => { const x = r.v[ci]; return x === null || x === undefined ? null : typeof x === 'number' ? x : String(x); },
      cell: (r: R) => (masked ? <MaskedText value={r.v[ci]} /> : <span className="sm-mono" style={r.v[ci] === null ? { color: 'var(--sm-fg-tertiary)' } : undefined}>{r.v[ci] === null ? '∅' : String(r.v[ci])}</span>),
      ...(ci === 0 ? { card: 'title' as const } : {}),
    })),
    [columns, masked],
  );
  if (!columns.length) return <p className="t-secondary" style={{ padding: 12 }}>No columns returned.</p>;
  return (
    <DataTable<R>
      rows={data}
      columns={cols}
      getId={(r) => String(r.i)}
      ariaLabel={ariaLabel}
      sort={sort}
      onSortChange={setSort}
      density={density}
      height={Math.min(360, 112 + data.length * (density === 'compact' ? 28 : 36))}
      footer={<span>{truncated ? `first ${fmtInt(rows.length)} of ${fmtInt(total)} rows` : `${fmtInt(total)} row${total === 1 ? '' : 's'}`}</span>}
    />
  );
}

export default function WorkbenchView() {
  const role = useRole();
  const qc = useQueryClient();
  const notify = useNotify();
  const reduced = useReducedMotion();
  const [backend] = useParam('backend', 'core_pg');
  const [sampleId, setSampleId] = useParam('sample', 'canonical');
  const [sqlParam, setSqlParam] = useParam('sql', '');
  const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];
  const sql = sqlParam || sample?.sql || '';
  const dialect = BACKENDS.find((b) => b.id === backend)?.dialect ?? 'postgresql';
  const [pane, setPane] = useParam('pane', 'rewritten');

  const [stage, dispatch] = useReducer((s: QueryStage, e: 'RUN' | 'NEXT' | 'REJECT' | 'FAIL' | 'RESET') => transition(QUERY_TRANSITIONS, s, e).state, 'idle' as QueryStage);
  const [states, setStates] = useState<Record<StageKey, 'idle' | 'active' | 'done' | 'fail' | 'skipped'>>({ parse: 'idle', validate: 'idle', rewrite: 'idle', execute: 'idle', mask: 'idle', audit: 'idle' });
  const [run, setRun] = useState<QueryRunResult | null>(null);
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const busy = stage !== 'idle' && stage !== 'done' && stage !== 'rejected' && stage !== 'failed';
  const runId = useRef(0);

  const execute = useCallback(async (): Promise<void> => {
    if (busy) return;
    const id = ++runId.current;
    const runRole = role;
    dispatch('RESET');
    dispatch('RUN');
    setError(null);
    setStates({ parse: 'active', validate: 'idle', rewrite: 'idle', execute: 'idle', mask: 'idle', audit: 'idle' });
    const t0 = performance.now();
    try {
      const res = await api.runQuery({ sql, backend, role: runRole });
      if (id !== runId.current) return;
      setRoundTrip(Math.round(performance.now() - t0));
      setRun(res);
      const pause = (): Promise<void> => new Promise((r) => setTimeout(r, reduced ? 0 : 170));
      const outcome = res.pipeline?.outcomes[runRole];
      const next: Record<StageKey, 'idle' | 'active' | 'done' | 'fail' | 'skipped'> = { parse: 'active', validate: 'idle', rewrite: 'idle', execute: 'idle', mask: 'idle', audit: 'idle' };
      const failAt: StageKey | null = res.fatal ? (res.fatal.code === 'SM-PARSE-001' ? 'parse' : res.fatal.code === 'SM-AUDIT-001' ? 'audit' : 'validate') : outcome?.violations.length ? 'validate' : null;
      for (let i = 0; i < STAGES.length; i++) {
        const s = STAGES[i] as (typeof STAGES)[number];
        next[s.key] = 'active';
        setStates({ ...next });
        await pause();
        if (id !== runId.current) return;
        if (failAt === s.key) {
          next[s.key] = 'fail';
          for (const rest of STAGES.slice(i + 1)) next[rest.key] = 'skipped';
          setStates({ ...next });
          dispatch(failAt === 'audit' ? 'FAIL' : 'REJECT');
          break;
        }
        next[s.key] = 'done';
        setStates({ ...next });
        dispatch('NEXT');
      }
      const first = res.fatal ?? outcome?.violations[0];
      if (first) notify({ title: `Query rejected: ${first.code}`, body: VIOLATION_TITLES[first.code], intent: 'warning' });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      const d = describeError(e);
      dispatch('FAIL');
      setError({ code: d.code, message: d.message });
      setStates({ parse: 'idle', validate: 'idle', rewrite: 'idle', execute: 'idle', mask: 'idle', audit: 'idle' });
    }
  }, [busy, role, sql, backend, reduced, notify, qc]);

  // Reset results when the backend changes so stale rows never sit beside a new dialect.
  useEffect(() => { setRun(null); dispatch('RESET'); setStates({ parse: 'idle', validate: 'idle', rewrite: 'idle', execute: 'idle', mask: 'idle', audit: 'idle' }); }, [backend, sampleId]);

  const outcome: RoleOutcome | undefined = run?.pipeline?.outcomes[role];
  const violations: Violation[] = run?.fatal ? [run.fatal] : outcome?.violations ?? [];
  const cols = outcome?.analysis?.outCols.map((c) => c.name) ?? run?.pipeline?.raw.columns ?? [];
  const pipeline = run?.pipeline;
  const rewritten = outcome?.rewrittenSql ?? '';
  const original = pipeline?.formattedSql ?? '';
  const diff = useMemo(() => (pipeline && rewritten ? lineDiff(original, rewritten) : []), [pipeline, original, rewritten]);
  const stats = diffStats(diff);
  const roleNote = run && run.role !== role ? `Timings and the audit event belong to the ${roleLabel(run.role)} run; results below are re-masked for ${roleLabel(role)}.` : null;

  useExportProvider(() => ({
    name: 'workbench-result',
    rows: (outcome?.masked ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null]))),
    summary: { role, backend, sql, queryHash: run?.audit.query_hash ?? null, auditEvent: run?.audit.id ?? null, overheadMsSimulated: run?.stages?.overhead ?? null },
  }));

  return (
    <ViewFrame
      title="Query Workbench"
      icon={<Code24Regular />}
      subtitle="Parse, validate, rewrite, execute, mask, audit. Switch role to watch the same result re-mask without re-running."
      commands={
        <Button appearance="primary" icon={<Play24Regular />} disabled={busy || !sql.trim()} onClick={() => void execute()} data-testid="run-query">
          {busy ? 'Running…' : 'Run query'} <span className="t-caption1" style={{ opacity: 0.8, marginLeft: 6 }}>Ctrl+Enter</span>
        </Button>
      }
    >
      <div className="sm-stack" style={{ gap: 16 }}>
        <section className="sm-card sm-stack" aria-label="Query editor">
          <div className="sm-row" style={{ justifyContent: 'space-between' }}>
            <div className="sm-row">
              <label htmlFor="wb-backend" className="t-caption1 t-secondary">Backend</label>
              <Dropdown
                id="wb-backend"
                value={`${backend} · ${BACKENDS.find((b) => b.id === backend)?.engine ?? ''}`}
                selectedOptions={[backend]}
                onOptionSelect={(_, d) => {
                  const b = String(d.optionValue);
                  const first = SAMPLES.find((s) => s.backend === b);
                  setParams({ backend: b === 'core_pg' ? null : b, sample: first && first.id !== 'canonical' ? first.id : null, sql: null }, { replace: true });
                }}
                style={{ minWidth: 220 }}
              >
                {BACKENDS.map((b) => <Option key={b.id} value={b.id} text={b.id}>{b.id} · {b.engine} · {b.approach === 'views' ? 'Approach A (secure views)' : 'Approach B (AST rewrite)'}</Option>)}
              </Dropdown>
              <label htmlFor="wb-sample" className="t-caption1 t-secondary">Example</label>
              <Dropdown
                id="wb-sample"
                value={sample?.title ?? ''}
                selectedOptions={[sample?.id ?? '']}
                onOptionSelect={(_, d) => { setSampleId(String(d.optionValue) === 'canonical' ? null : String(d.optionValue)); setSqlParam(null); }}
                style={{ minWidth: 260 }}
              >
                {SAMPLES.filter((s) => s.backend === backend).map((s) => <Option key={s.id} value={s.id} text={s.title}>{s.title}</Option>)}
              </Dropdown>
            </div>
            <Chip tone="neutral">{BACKENDS.find((b) => b.id === backend)?.approach === 'views' ? 'Approach A · per-role secure views' : 'Approach B · AST rewriting'}</Chip>
          </div>
          <CodeEditor value={sql} onChange={(v) => setSqlParam(v === sample?.sql ? null : v)} language="sql" dialect={dialect} ariaLabel="SQL editor" height={170} diagnostics={parseDiagnostics} onRun={() => void execute()} />
          {sample && sample.sql === sql && <p className="t-caption1 t-secondary" style={{ margin: 0 }}><strong>What to look for:</strong> {sample.expect}</p>}
        </section>

        <StageStrip states={states} timings={run?.stages ?? null} runRole={run ? roleLabel(run.role) : null} total={roundTrip} cacheHit={run && run.stages ? run.cacheHit : null} />

        {error && (
          <MessageBar intent="error" role="alert"><MessageBarBody><MessageBarTitle>{error.code}</MessageBarTitle>{error.message}</MessageBarBody></MessageBar>
        )}
        {violations.map((v, i) => (
          <MessageBar key={i} intent={v.code === 'SM-AUDIT-001' ? 'error' : 'warning'} role="alert" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>{v.code} · {VIOLATION_TITLES[v.code]}</MessageBarTitle>
              {v.message} <em>{HINTS[v.code]}</em>
            </MessageBarBody>
          </MessageBar>
        ))}
        {roleNote && <MessageBar intent="info"><MessageBarBody>{roleNote}</MessageBarBody></MessageBar>}

        {busy && !run && <div className="sm-card" role="status" aria-label="Running"><Skel w="30%" h={14} /><div style={{ height: 10 }} /><Skel h={120} /></div>}

        {pipeline && (
          <div className="sm-split" style={{ alignItems: 'start' }}>
            <section className="sm-stack" aria-label="Caller result">
              <div className="sm-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="t-subtitle1" style={{ margin: 0 }}>Result as <RoleChip role={role} /></h2>
                {outcome?.analysis && <span className="t-caption1 t-secondary">{outcome.analysis.masks.length} masked column(s): {outcome.analysis.masks.map((m) => m.fn).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'none'}</span>}
              </div>
              {outcome?.masked ? (
                <ResultGrid columns={cols} rows={outcome.masked} masked ariaLabel={`Masked result for ${roleLabel(role)}`} truncated={pipeline.truncated} total={pipeline.rowCount} />
              ) : (
                <div className="sm-card"><div className="sm-panel-msg"><div className="t-subtitle2">No rows were returned to this role</div><div>The query was refused before execution; see the message above.</div></div></div>
              )}
            </section>
            <section className="sm-stack" aria-label="Base table result">
              <div className="sm-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="t-subtitle1" style={{ margin: 0 }}>Base-table result</h2>
                <Chip tone="warn">Evaluator connection, demo only</Chip>
              </div>
              <ResultGrid columns={pipeline.raw.columns} rows={pipeline.raw.rows} masked={false} ariaLabel="Base-table result (evaluator connection)" truncated={pipeline.truncated} total={pipeline.rowCount} />
            </section>
          </div>
        )}

        {pipeline && (
          <section className="sm-card sm-stack" aria-label="Rewritten SQL">
            <div className="sm-row" style={{ justifyContent: 'space-between' }}>
              <h2 className="t-subtitle1" style={{ margin: 0 }}>Rewritten SQL for {roleLabel(role)}</h2>
              <TabList size="small" selectedValue={pane} onTabSelect={(_, d) => setPane(String(d.value))}>
                <Tab value="rewritten">Rewritten</Tab>
                <Tab value="diff">Diff {rewritten ? `(+${stats.added} −${stats.removed})` : ''}</Tab>
                <Tab value="original">Original</Tab>
                {(outcome?.viewDdl.length ?? 0) > 0 && <Tab value="views">Secure views</Tab>}
              </TabList>
            </div>
            {!outcome?.analysis ? (
              <p className="t-secondary" style={{ margin: 0 }}>Nothing to rewrite: the query was rejected for this role.</p>
            ) : pane === 'diff' ? (
              stats.added + stats.removed === 0 ? <p className="t-secondary" style={{ margin: 0 }}>No rewrite for {roleLabel(role)}: Admin reads plaintext, and the query touches no masked column.</p> :
              <div className="sm-diff" role="region" aria-label="Diff of original and rewritten SQL" tabIndex={0}>{diff.map((l, i) => <div key={i} className={l.type === 'same' ? '' : l.type}>{l.text || ' '}</div>)}</div>
            ) : pane === 'original' ? (
              <pre className="sm-pre" tabIndex={0}>{original}</pre>
            ) : pane === 'views' ? (
              <pre className="sm-pre" tabIndex={0}>{outcome.viewDdl.join('\n\n')}</pre>
            ) : (
              <pre className="sm-pre" tabIndex={0}>{rewritten}</pre>
            )}
            <p className="t-caption1 t-secondary" style={{ margin: 0 }}>
              Audit event #{run?.audit.id} · query_hash {run?.audit.query_hash?.slice(0, 16) ?? '—'}… · {run?.audit.outcome} · written to the hash chain
              <Button size="small" appearance="subtle" onClick={() => setParams({ open: `audit:${run?.audit.id}`, dtab: null }, { replace: false })} style={{ marginLeft: 8 }}>Open event</Button>
            </p>
          </section>
        )}
        {!run && !busy && (
          <div className="sm-card"><div className="sm-panel-msg"><Code24Regular className="sm-icon-xl" aria-hidden /><div className="t-subtitle1">Run a query to see all three views</div><div>Pick an example above, then press Run (Ctrl+Enter). You will get the caller’s masked result, the base-table result for the evaluator, and the rewritten SQL.</div></div></div>
        )}
        <span className="sm-visually-hidden" role="status">{DEFAULT_PRINCIPAL[role]} {stage}</span>
      </div>
    </ViewFrame>
  );
}
