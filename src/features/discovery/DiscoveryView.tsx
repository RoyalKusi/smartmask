import {
  Button, Dropdown, Input, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, Option, Tooltip,
} from '@fluentui/react-components';
import { Add24Regular, Edit24Regular, Flash24Regular, ScanDash24Regular, Search24Regular } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { describeError } from '../../shared/api/errors';
import { api } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import type { ColumnRecord, ScanSummary } from '../../shared/api/types';
import { SCAN_TRANSITIONS, transition, type ScanStage } from '../../shared/engine/fsm';
import { COLUMN_STATES, TAGS } from '../../shared/engine/types';
import { Chip, StateChip, TagChip } from '../../shared/ui/Chips';
import { DataTable, type Column, type SortSpec } from '../../shared/ui/DataTable';
import { NpeBars, ProgressRing } from '../../shared/ui/Gauge';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { TableSkeleton } from '../../shared/ui/Skeleton';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useBackends, useColumns } from '../../app/queries';
import { setParams, useListParam, useParam, useRole } from '../../app/router';
import { useUi } from '../../app/store';

const STAGE_LABEL: Record<ScanStage, string> = {
  idle: 'Idle', connect: 'Connecting', catalog: 'Reading catalog', sample: 'Sampling values', score: 'Scoring N · P · E', classify: 'Running classifier', complete: 'Complete', failed: 'Failed',
};

function parseSort(v: string): SortSpec | null {
  const [id, dir] = v.split(':');
  return id ? { id, desc: dir === 'desc' } : null;
}

function ScoreGauge({ s }: { s: number }) {
  return (
    <div role="img" aria-label={`Score ${s.toFixed(3)}: ${s >= 0.7 ? 'enforced' : s >= 0.4 ? 'review' : 'clear'}`} style={{ position: 'relative', width: 96, height: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ position: 'relative', flex: 1, height: 6, borderRadius: 3, background: 'var(--sm-stroke-subtle)' }}>
        <i style={{ position: 'absolute', inset: 0, width: `${Math.min(100, s * 100)}%`, borderRadius: 3, background: s >= 0.7 ? 'var(--sm-success)' : s >= 0.4 ? 'var(--sm-warning)' : 'var(--sm-fg-tertiary)' }} />
        <i style={{ position: 'absolute', left: '40%', top: -2, bottom: -2, width: 1, background: 'var(--sm-fg-tertiary)' }} />
        <i style={{ position: 'absolute', left: '70%', top: -2, bottom: -2, width: 1, background: 'var(--sm-fg-tertiary)' }} />
      </span>
      <span className="sm-num" style={{ width: 38, textAlign: 'right' }}>{s.toFixed(3)}</span>
    </div>
  );
}

interface ScanSession {
  backend: string;
  stage: ScanStage;
  pct: number;
  revealed: ColumnRecord[];
  drift: boolean;
}

export default function DiscoveryView() {
  const role = useRole();
  const cols = useColumns();
  const backends = useBackends();
  const qc = useQueryClient();
  const notify = useNotify();
  const density = useUi((s) => s.density);
  const setAddBackendOpen = useUi((s) => s.setAddBackendOpen);
  const setOverride = useUi((s) => s.setOverrideColumn);

  const [conn, setConn] = useParam('conn', 'all');
  const [states, setStates] = useListParam('state');
  const [tags, setTags] = useListParam('tag');
  const [smin, setSmin] = useParam('smin', '0');
  const [smax, setSmax] = useParam('smax', '1');
  const [q, setQ] = useParam('q', '');
  const [sortRaw, setSortRaw] = useParam('sort', '');
  const [scanParam] = useParam('scan', '');
  const [driftParam] = useParam('drift', '');
  const [selected, setSelected] = useState<string[]>([]);
  const [scan, setScan] = useState<ScanSession | null>(null);
  const [scanState, dispatchScan] = useReducer((s: ScanStage, e: 'START' | 'NEXT' | 'FAIL' | 'RESET') => transition(SCAN_TRANSITIONS, s, e).state, 'idle' as ScanStage);
  const [scanError, setScanError] = useState<{ code: string; message: string; backend: string } | null>(null);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [driftInfo, setDriftInfo] = useState<{ from: string; to: string } | null>(null);
  const running = useRef(false);

  const machine = useLoadMachine(cols, (d) => d.length === 0);
  const sort = parseSort(sortRaw);

  const runScan = useCallback(
    async (backend: string, drift = false): Promise<void> => {
      if (running.current) return;
      running.current = true;
      setScanError(null);
      setSummary(null);
      setScan({ backend, stage: 'connect', pct: 0, revealed: [], drift });
      dispatchScan('RESET');
      dispatchScan('START');
      let last: ScanStage = 'connect';
      try {
        const s = await api.scan(backend, (p) => {
          while (last !== p.stage) {
            dispatchScan('NEXT');
            last = SCAN_STAGE_ORDER[SCAN_STAGE_ORDER.indexOf(last) + 1] ?? p.stage;
          }
          setScan({ backend, stage: p.stage, pct: p.pct, revealed: p.revealed, drift });
        });
        while (last !== 'classify') {
          dispatchScan('NEXT');
          last = SCAN_STAGE_ORDER[SCAN_STAGE_ORDER.indexOf(last) + 1] ?? 'classify';
        }
        dispatchScan('NEXT');
        setSummary(s);
        notify({
          title: `Scan of ${backend} complete`,
          body: `${s.columns} columns · ${s.enforced} enforced · ${s.review} in review${s.added.length ? ` · ${s.added.length} new` : ''}${s.removed.length ? ` · ${s.removed.length} removed` : ''}`,
        });
        await qc.invalidateQueries({ queryKey: ['columns'] });
      } catch (e) {
        const d = describeError(e);
        dispatchScan('FAIL');
        setScanError({ code: d.code, message: d.message, backend });
        notify({ title: `Scan failed (${d.code})`, body: d.message, intent: 'error' });
      } finally {
        running.current = false;
        setScan(null);
      }
    },
    [notify, qc],
  );

  useEffect(() => {
    if (scanParam) {
      setParams({ scan: null }, { replace: true });
      void runScan(conn === 'all' ? 'core_pg' : conn);
    }
    // One-shot trigger from the command palette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanParam]);

  useEffect(() => {
    if (!driftParam) return;
    setParams({ drift: null }, { replace: true });
    void (async () => {
      try {
        const d = await api.simulateDrift();
        setDriftInfo({ from: d.from, to: d.to });
        notify({ title: 'Schema drift detected', body: `${d.backend}.${d.table}.${d.from} was renamed to ${d.to}. Rescanning.`, intent: 'warning' });
        await runScan(d.backend, true);
      } catch (e) {
        notify({ title: 'Could not simulate drift', body: describeError(e).message, intent: 'error' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driftParam]);

  const all = useMemo(() => {
    const base = cols.data ?? [];
    if (!scan) return base;
    return [...base.filter((r) => r.backend !== scan.backend), ...scan.revealed];
  }, [cols.data, scan]);

  const lo = Number(smin);
  const hi = Number(smax);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (conn === 'all' || r.backend === conn) &&
        (!states.length || states.includes(r.state)) &&
        (!tags.length || (r.tag !== null && tags.includes(r.tag)) || (r.state === 'REVIEW' && r.suggestedTag !== null && tags.includes(r.suggestedTag))) &&
        r.s >= lo - 1e-9 && r.s <= hi + 1e-9 &&
        (!needle || `${r.table}.${r.column} ${r.family}`.toLowerCase().includes(needle)),
    );
  }, [all, conn, states, tags, lo, hi, q]);

  useExportProvider(() => ({
    name: 'discovery-columns',
    rows: filtered.map((r) => ({ backend: r.backend, table: r.table, column: r.column, family: r.family, tag: r.tag ?? '', state: r.state, N: +r.n.toFixed(3), P: +r.p.toFixed(3), E: +r.e.toFixed(3), S: +r.s.toFixed(3), M: +r.m.toFixed(3) })),
    summary: { connection: conn, states, tags, scoreRange: [lo, hi], search: q, total: all.length, shown: filtered.length },
  }));

  const columns = useMemo<Column<ColumnRecord>[]>(
    () => [
      { id: 'table', header: 'Table', width: 130, sortValue: (r) => r.table, cell: (r) => <span className="sm-mono">{r.table}</span>, card: 'hide' },
      { id: 'column', header: 'Column', width: 190, sortValue: (r) => r.column, cell: (r) => <strong className="sm-mono" title={`${r.table}.${r.column}`}>{r.column}</strong>, card: 'title' },
      { id: 'family', header: 'Family', width: 110, sortValue: (r) => r.family, cell: (r) => r.family.replace('_', ' ') },
      { id: 'tag', header: 'Tag', width: 190, sortValue: (r) => r.tag ?? r.suggestedTag ?? '', cell: (r) => <TagChip tag={r.tag ?? (r.state === 'REVIEW' ? r.suggestedTag : null)} />, filter: { options: TAGS.map((t) => ({ value: t, label: t })), selected: tags, onChange: (v) => setTags(v) } },
      { id: 'npe', header: 'N · P · E', width: 96, cell: (r) => <NpeBars n={r.n} p={r.p} e={r.e} /> },
      { id: 's', header: 'Score S', width: 150, align: 'left', sortValue: (r) => r.s, cell: (r) => <ScoreGauge s={r.s} /> },
      { id: 'm', header: 'ML M', width: 76, align: 'right', sortValue: (r) => r.m, cell: (r) => <span className="sm-num" style={{ fontWeight: r.m >= 0.85 ? 600 : 400 }}>{r.m.toFixed(2)}</span> },
      { id: 'state', header: 'State', width: 140, sortValue: (r) => r.state, cell: (r) => <StateChip state={r.state} />, filter: { options: COLUMN_STATES.map((s) => ({ value: s, label: s })), selected: states, onChange: (v) => setStates(v) } },
      {
        id: 'act', header: '', width: 56, card: 'hide',
        cell: (r) => (
          <Tooltip content="Override this column" relationship="label">
            <Button size="small" appearance="subtle" icon={<Edit24Regular />} onClick={(e) => { e.stopPropagation(); setOverride(r.id); }} />
          </Tooltip>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tags, states],
  );

  const hasFilters = states.length > 0 || tags.length > 0 || q !== '' || lo > 0 || hi < 1 || conn !== 'all';
  const clearFilters = (): void => setParams({ state: null, tag: null, smin: null, smax: null, q: null, conn: null }, { replace: true });
  const backendList = backends.data ?? [];

  return (
    <ViewFrame
      title="Discovery"
      icon={<ScanDash24Regular />}
      subtitle="Every column scored as S = 0.30·N + 0.55·P + 0.15·E. Values are sampled and scored in place; raw values are never stored in the catalog."
      commands={
        <>
          <Dropdown
            aria-label="Connection"
            value={conn === 'all' ? 'All connections' : conn}
            selectedOptions={[conn]}
            onOptionSelect={(_, d) => setConn(String(d.optionValue), false)}
            style={{ minWidth: 190 }}
          >
            <Option value="all" text="All connections">All connections</Option>
            {backendList.map((b) => (
              <Option key={b.id} value={b.id} text={b.id}>{b.id} · {b.engine}</Option>
            ))}
          </Dropdown>
          <Button appearance="primary" icon={scan ? undefined : <Flash24Regular />} disabled={!!scan} onClick={() => void runScan(conn === 'all' ? 'core_pg' : conn)}>
            {scan ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ProgressRing pct={scan.pct} size={24} label="Scan progress" />{STAGE_LABEL[scan.stage]}…</span> : `Scan ${conn === 'all' ? 'core_pg' : conn}`}
          </Button>
          <Button icon={<Add24Regular />} onClick={() => setAddBackendOpen(true)}>Add backend</Button>
          <Button onClick={() => setParams({ drift: '1' }, { replace: true })} disabled={!!scan}>Simulate schema drift</Button>
        </>
      }
    >
      <div aria-live="polite" className="sm-visually-hidden" role="status">
        {scan ? `${STAGE_LABEL[scan.stage]}, ${scan.pct} percent` : scanState === 'complete' ? 'Scan complete' : ''}
      </div>
      {scan && (
        <div className="sm-card" style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
          <ProgressRing pct={scan.pct} label={`Scanning ${scan.backend}`} />
          <div style={{ flex: 1 }}>
            <div className="t-body1s">Scanning {scan.backend}{scan.drift ? ' after schema drift' : ''}</div>
            <ol aria-label="Scan stages" style={{ display: 'flex', gap: 12, listStyle: 'none', padding: 0, margin: '4px 0 0', flexWrap: 'wrap' }}>
              {SCAN_STAGE_ORDER.map((s) => (
                <li key={s} className="t-caption1" style={{ color: s === scan.stage ? 'var(--sm-brand)' : SCAN_STAGE_ORDER.indexOf(s) < SCAN_STAGE_ORDER.indexOf(scan.stage) ? 'var(--sm-success)' : 'var(--sm-fg-tertiary)', fontWeight: s === scan.stage ? 600 : 400 }}>
                  {SCAN_STAGE_ORDER.indexOf(s) < SCAN_STAGE_ORDER.indexOf(scan.stage) ? '✓ ' : ''}{STAGE_LABEL[s]}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {scanError && (
        <MessageBar intent="error" style={{ marginBottom: 12 }}>
          <MessageBarBody>
            <MessageBarTitle>Scan of {scanError.backend} failed · {scanError.code}</MessageBarTitle>
            {scanError.message}
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => void runScan(scanError.backend)}>Retry scan</Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {driftInfo && !scan && (
        <MessageBar intent="warning" style={{ marginBottom: 12 }}>
          <MessageBarBody>
            <MessageBarTitle>Schema drift reconciled</MessageBarTitle>
            <span className="sm-mono">contacts.{driftInfo.from}</span> became <span className="sm-mono">contacts.{driftInfo.to}</span>. Until the rescan the new column was masked fail-closed; it is now scored on its own evidence and, with no name hint, lands in the Review Queue.
          </MessageBarBody>
          <MessageBarActions><Button size="small" onClick={() => setParams({ q: driftInfo.to }, { replace: true })}>Show column</Button></MessageBarActions>
        </MessageBar>
      )}
      {summary && !scan && summary.columns === 0 && (
        <MessageBar intent="info" style={{ marginBottom: 12 }}>
          <MessageBarBody>{summary.backend} has no tables in this synthetic environment, so there is nothing to score yet.</MessageBarBody>
        </MessageBar>
      )}

      <div className="sm-card sm-filterbar" role="search" aria-label="Filter columns">
        <div className="sm-field" style={{ minWidth: 220 }}>
          <label htmlFor="disc-q">Search</label>
          <Input id="disc-q" contentBefore={<Search24Regular />} value={q} placeholder="table.column or family" onChange={(_, d) => setQ(d.value || null)} />
        </div>
        <div className="sm-field">
          <label id="lbl-state">State</label>
          <Dropdown aria-labelledby="lbl-state" multiselect placeholder="Any state" value={states.join(', ')} selectedOptions={states} onOptionSelect={(_, d) => setStates(d.selectedOptions)}>
            {COLUMN_STATES.map((s) => <Option key={s} value={s}>{s}</Option>)}
          </Dropdown>
        </div>
        <div className="sm-field">
          <label id="lbl-tag">Tag</label>
          <Dropdown aria-labelledby="lbl-tag" multiselect placeholder="Any tag" value={tags.join(', ')} selectedOptions={tags} onOptionSelect={(_, d) => setTags(d.selectedOptions)}>
            {TAGS.map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Dropdown>
        </div>
        <div className="sm-field" style={{ minWidth: 200 }}>
          <label htmlFor="disc-smin">Min score: {lo.toFixed(2)}</label>
          <input id="disc-smin" className="sm-range" type="range" min={0} max={1} step={0.05} value={lo} onChange={(e) => { const v = Math.min(Number(e.target.value), hi); setSmin(v === 0 ? null : String(v)); }} />
        </div>
        <div className="sm-field" style={{ minWidth: 200 }}>
          <label htmlFor="disc-smax">Max score: {hi.toFixed(2)}</label>
          <input id="disc-smax" className="sm-range" type="range" min={0} max={1} step={0.05} value={hi} onChange={(e) => { const v = Math.max(Number(e.target.value), lo); setSmax(v === 1 ? null : String(v)); }} />
        </div>
        {hasFilters && <Button appearance="subtle" onClick={clearFilters}>Clear filters</Button>}
      </div>

      <Region
        machine={machine}
        skeleton={<TableSkeleton rows={12} height={520} />}
        empty={<EmptyPanel title="The catalog is empty" action={<Button appearance="primary" onClick={() => void runScan('core_pg')}>Run first scan</Button>}>No columns have been discovered yet.</EmptyPanel>}
      >
        {filtered.length === 0 ? (
          <EmptyPanel
            title={scan ? 'Waiting for scored columns…' : conn !== 'all' && !all.some((r) => r.backend === conn) ? `${conn} has no discovered columns` : 'No columns match these filters'}
            action={hasFilters ? <Button onClick={clearFilters}>Clear filters</Button> : <Button appearance="primary" onClick={() => void runScan(conn === 'all' ? 'core_pg' : conn)}>Scan {conn === 'all' ? 'core_pg' : conn}</Button>}
          >
            {conn !== 'all' && !all.some((r) => r.backend === conn) ? 'This backend has no tables in the synthetic environment. Scan it to confirm.' : 'Adjust the state, tag or score filters.'}
          </EmptyPanel>
        ) : (
          <DataTable<ColumnRecord>
            rows={filtered}
            columns={columns}
            getId={(r) => r.id}
            ariaLabel="Discovered columns"
            sort={sort}
            onSortChange={(s) => setSortRaw(s ? `${s.id}:${s.desc ? 'desc' : 'asc'}` : null)}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            density={density}
            animateRows={!!scan}
            onOpen={(r) => setParams({ open: `column:${r.id}`, dtab: null }, { replace: false })}
            bulkActions={(rows, clear) => (
              <Button
                size="small"
                appearance="primary"
                disabled={!rows.some((r) => r.state === 'REVIEW')}
                onClick={async () => {
                  const todo = rows.filter((r) => r.state === 'REVIEW');
                  const prev: ColumnRecord[] = [];
                  for (const r of todo) prev.push((await api.decide({ columnId: r.id, action: 'APPROVE', reason: 'Bulk approval of suggested tag from Discovery.' }, DEFAULT_PRINCIPAL[role])).previous);
                  clear();
                  await qc.invalidateQueries();
                  notify({
                    title: `Approved ${todo.length} column(s)`,
                    body: 'Suggested tags are now enforced.',
                    undo: () => { void Promise.all(prev.map((p) => api.undoDecision(p, DEFAULT_PRINCIPAL[role]))).then(() => qc.invalidateQueries()); },
                  });
                }}
              >
                Approve suggested tags ({rows.filter((r) => r.state === 'REVIEW').length} in review)
              </Button>
            )}
            footer={<Chip tone="neutral">{all.length} total · {filtered.length} shown</Chip>}
          />
        )}
      </Region>
    </ViewFrame>
  );
}

const SCAN_STAGE_ORDER: ScanStage[] = ['connect', 'catalog', 'sample', 'score', 'classify'];
