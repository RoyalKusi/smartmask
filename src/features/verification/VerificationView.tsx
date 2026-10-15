import { Button, Spinner } from '@fluentui/react-components';
import { CheckmarkCircle24Filled, DismissCircle24Filled, ShieldCheckmark24Regular, Play24Regular } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import { describeError } from '../../shared/api/errors';
import type { VerificationBatch } from '../../shared/api/types';
import { Chip } from '../../shared/ui/Chips';
import { DataTable, type Column } from '../../shared/ui/DataTable';
import { fmtInt, fmtTime, shortHash } from '../../shared/ui/format';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { CardsSkeleton, TableSkeleton } from '../../shared/ui/Skeleton';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useVerification } from '../../app/queries';
import { setParams, useListParam, useParam, useRole } from '../../app/router';
import { useUi } from '../../app/store';

interface TableRow { table: string; backend: string; rows: number; sha: string; match: boolean; checks: number; last: string }

function Match({ ok }: { ok: boolean }) {
  return ok ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sm-success)', fontWeight: 600 }}><CheckmarkCircle24Filled style={{ width: 18, height: 18 }} aria-hidden />Match</span>
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sm-danger)', fontWeight: 600 }}><DismissCircle24Filled style={{ width: 18, height: 18 }} aria-hidden />MISMATCH</span>
  );
}

export default function VerificationView() {
  const q = useVerification();
  const m = useLoadMachine(q, (d) => d.baseline.length === 0);
  const qc = useQueryClient();
  const notify = useNotify();
  const role = useRole();
  const density = useUi((s) => s.density);
  const [running, setRunning] = useState(false);
  const [sortRaw, setSortRaw] = useParam('sort', '');
  const [backends, setBackends] = useListParam('backend');
  const [selected, setSelected] = useState<string[]>([]);

  const rows = useMemo<TableRow[]>(() => {
    const hist = q.data?.history ?? [];
    return (q.data?.baseline ?? [])
      .filter((b) => !backends.length || backends.includes(b.backend))
      .map((b) => {
        const touches = hist.filter((h) => h.tables.some((t) => t.table === b.table));
        const bad = touches.some((h) => h.tables.some((t) => t.table === b.table && t.before !== t.after));
        return { table: b.table, backend: b.backend, rows: b.rows, sha: b.sha, match: !bad, checks: touches.length, last: touches[0]?.at ?? '' };
      });
  }, [q.data, backends]);

  const allMatch = (q.data?.history ?? []).every((h) => h.match);
  const sort = sortRaw ? { id: sortRaw.split(':')[0] as string, desc: sortRaw.endsWith(':desc') } : null;

  useExportProvider(() => ({
    name: 'verification',
    rows: rows.map((r) => ({ table: r.table, backend: r.backend, rows: r.rows, sha256: r.sha, matchesBaseline: r.match, verificationsRecorded: r.checks })),
    summary: { tables: rows.length, allMatch, batches: q.data?.history.length ?? 0 },
  }));

  const columns = useMemo<Column<TableRow>[]>(() => [
    { id: 'table', header: 'Base table', width: 190, sortValue: (r) => r.table, cell: (r) => <strong className="sm-mono">{r.table}</strong>, card: 'title' },
    { id: 'backend', header: 'Backend', width: 130, sortValue: (r) => r.backend, cell: (r) => r.backend, filter: { options: ['core_pg', 'ledger_lite', 'crm_mysql'].map((b) => ({ value: b, label: b })), selected: backends, onChange: setBackends } },
    { id: 'rows', header: 'Rows', width: 100, align: 'right', sortValue: (r) => r.rows, cell: (r) => <span className="sm-num">{fmtInt(r.rows)}</span> },
    { id: 'sha', header: 'SHA-256 (current)', width: 300, cell: (r) => <span className="sm-mono" title={r.sha}>{shortHash(r.sha, 32)}</span> },
    { id: 'checks', header: 'Checks', width: 90, align: 'right', sortValue: (r) => r.checks, cell: (r) => <span className="sm-num">{r.checks}</span> },
    { id: 'match', header: 'Before = after', width: 140, sortValue: (r) => (r.match ? 1 : 0), cell: (r) => <Match ok={r.match} /> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [backends]);

  const batch = async (): Promise<void> => {
    setRunning(true);
    try {
      const b = await api.runVerificationBatch(DEFAULT_PRINCIPAL[role]);
      await qc.invalidateQueries({ queryKey: ['verification'] });
      notify({ title: b.match ? 'Verification passed' : 'Verification FAILED', body: `${b.tables.length} base tables hashed before and after the golden-query batch.`, intent: b.match ? 'success' : 'error' });
    } catch (e) {
      notify({ title: 'Verification could not run', body: describeError(e).message, intent: 'error' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <ViewFrame
      title="Verification"
      icon={<ShieldCheckmark24Regular />}
      subtitle="Proof that raw data is unchanged: SHA-256 of every base table before and after each query batch."
      commands={<Button appearance="primary" icon={running ? <Spinner size="tiny" /> : <Play24Regular />} disabled={running} onClick={() => void batch()}>Run verification batch</Button>}
    >
      <Region machine={m} skeleton={<div className="sm-stack"><CardsSkeleton count={3} height={110} /><TableSkeleton rows={10} height={460} /></div>} empty={<EmptyPanel title="No base tables registered">Add a backend and scan it first.</EmptyPanel>}>
        <div className="sm-stack" style={{ gap: 16 }}>
          <div className="sm-grid">
            <div className="sm-card sm-col-4" role="status">
              <div className="t-caption1 t-secondary">Integrity</div>
              <div className="t-title2" style={{ color: allMatch ? 'var(--sm-success)' : 'var(--sm-danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {allMatch ? <CheckmarkCircle24Filled aria-hidden /> : <DismissCircle24Filled aria-hidden />}{allMatch ? 'Raw data unchanged' : 'Mismatch detected'}
              </div>
              <div className="t-secondary">{allMatch ? 'Every recorded batch has before = after for every table it touched.' : 'At least one recorded batch changed a base table.'}</div>
            </div>
            <div className="sm-card sm-col-4"><div className="t-caption1 t-secondary">Tables under verification</div><div className="t-display sm-num">{q.data?.baseline.length ?? 0}</div><div className="t-secondary">{fmtInt((q.data?.baseline ?? []).reduce((s, b) => s + b.rows, 0))} rows hashed in 2,000-row blocks</div></div>
            <div className="sm-card sm-col-4"><div className="t-caption1 t-secondary">Batches recorded</div><div className="t-display sm-num">{q.data?.history.length ?? 0}</div><div className="t-secondary">Each Workbench query adds one automatically.</div></div>
          </div>

          <DataTable<TableRow>
            rows={rows}
            columns={columns}
            getId={(r) => r.table}
            ariaLabel="Base table checksums"
            sort={sort}
            onSortChange={(s) => setSortRaw(s ? `${s.id}:${s.desc ? 'desc' : 'asc'}` : null)}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            density={density}
            height={Math.min(560, 120 + rows.length * (density === 'compact' ? 28 : 36))}
            onOpen={(r) => setParams({ open: `table:${r.table}`, dtab: null }, { replace: false })}
            bulkActions={(sel) => <span className="t-secondary">{fmtInt(sel.reduce((s, r) => s + r.rows, 0))} rows selected</span>}
          />

          <section className="sm-card" aria-labelledby="timeline-h">
            <h2 id="timeline-h" className="t-subtitle1" style={{ marginTop: 0 }}>Verification timeline</h2>
            <ol className="sm-timeline" aria-label="Verification batches">
              {(q.data?.history ?? []).slice(0, 14).map((b: VerificationBatch) => (
                <li key={b.id} data-tone={b.match ? 'ok' : 'bad'}>
                  <details>
                    <summary style={{ cursor: 'pointer' }}>
                      <span className="t-body1s">{b.label}</span> <Match ok={b.match} /> <span className="t-caption1 t-tertiary">· {fmtTime(b.at)} · {b.actor} · {b.tables.length} table(s)</span>
                    </summary>
                    <table className="sm-matrix" style={{ marginTop: 8 }} aria-label={`Checksums for ${b.label}`}>
                      <thead><tr><th scope="col">Table</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Result</th></tr></thead>
                      <tbody>
                        {b.tables.map((t) => (
                          <tr key={t.table}><td className="sm-mono">{t.table}</td><td className="sm-mono">{shortHash(t.before, 16)}</td><td className="sm-mono">{shortHash(t.after, 16)}</td><td>{t.before === t.after ? 'equal' : 'DIFFERENT'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </li>
              ))}
            </ol>
            {!(q.data?.history.length) && <Chip tone="neutral">No batches yet</Chip>}
          </section>
        </div>
      </Region>
    </ViewFrame>
  );
}
