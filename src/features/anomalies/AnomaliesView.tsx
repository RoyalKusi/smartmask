import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Tab, TabList,
} from '@fluentui/react-components';
import { Alert24Regular, Checkmark24Regular, Dismiss24Regular, Open24Regular } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { api } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import { describeError } from '../../shared/api/errors';
import type { AnomalyAlert } from '../../shared/api/types';
import { FEATURES } from '../../shared/data/anomalies';
import { ChartFrame, useChartColors } from '../../shared/ui/ChartFrame';
import { Chip, RoleChip } from '../../shared/ui/Chips';
import { DataTable, type Column } from '../../shared/ui/DataTable';
import { fmtTime } from '../../shared/ui/format';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { CardsSkeleton, TableSkeleton } from '../../shared/ui/Skeleton';
import { useFocusReturn } from '../../shared/ui/useFocusReturn';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useAnomalies } from '../../app/queries';
import { setParams, useParam, useRole } from '../../app/router';
import { useUi } from '../../app/store';

const fmtFeature = (name: string, v: number): string => (name === 'Denied ratio' || name === 'Off-hours share' ? `${Math.round(v * 100)}%` : v.toLocaleString('en-US', { maximumFractionDigits: 0 }));

function ScoreBar({ s }: { s: number }) {
  const pct = Math.max(0, Math.min(1, (s - 0.5) / 0.5));
  return (
    <div role="img" aria-label={`Isolation score ${s.toFixed(3)}`} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--sm-stroke-subtle)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct * 100}%`, background: s >= 0.7 ? 'var(--sm-danger)' : 'var(--sm-warning)' }} /></span>
      <span className="sm-num" style={{ width: 44 }}>{s.toFixed(3)}</span>
    </div>
  );
}

function RadarPanel({ a }: { a: AnomalyAlert }) {
  const colors = useChartColors();
  const data = FEATURES.map((f, i) => {
    const p95 = a.fleetP95[i] || 1;
    return { feature: f, alert: Math.min(1.6, (a.features[i] ?? 0) / p95), baseline: Math.min(1.6, (a.baseline[i] ?? 0) / p95), raw: a.features[i] ?? 0, base: a.baseline[i] ?? 0 };
  });
  return (
    <ChartFrame
      title={`Feature radar · ${a.principal}`}
      description={`Radar chart comparing ${a.principal}'s activity on ${a.day} with their own median day, each feature scaled to the fleet 95th percentile.`}
      height={300}
      table={{ columns: ['Feature', 'This day', 'Own median', 'Fleet P95'], rows: FEATURES.map((f, i) => [f, fmtFeature(f, a.features[i] ?? 0), fmtFeature(f, a.baseline[i] ?? 0), fmtFeature(f, a.fleetP95[i] ?? 0)]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%" accessibilityLayer>
          <PolarGrid stroke={colors.strokeSubtle} />
          <PolarAngleAxis dataKey="feature" tick={{ fill: colors.fgSecondary, fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 1.6]} tick={false} axisLine={false} />
          <Tooltip contentStyle={{ background: colors.bgSurface, border: `1px solid ${colors.strokeDefault}`, borderRadius: 8, color: colors.fgPrimary }} formatter={(v, n) => [`${(Number(v) * 100).toFixed(0)}% of fleet P95`, String(n)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Radar name="Own median day" dataKey="baseline" stroke={colors.chartNeutral} fill={colors.chartNeutral} fillOpacity={0.2} />
          <Radar name={`${a.day}`} dataKey="alert" stroke={colors.danger} fill={colors.danger} fillOpacity={0.3} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export default function AnomaliesView() {
  const q = useAnomalies();
  const m = useLoadMachine(q, (d) => d.alerts.length === 0);
  const qc = useQueryClient();
  const notify = useNotify();
  const role = useRole();
  const actor = DEFAULT_PRINCIPAL[role];
  const density = useUi((s) => s.density);
  const [tab, setTab] = useParam('status', 'open');
  const [sel, setSel] = useParam('alert', '');
  const [confirm, setConfirm] = useState<AnomalyAlert | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  useFocusReturn(confirm !== null);

  const alerts = q.data?.alerts ?? [];
  const shown = useMemo(() => alerts.filter((a) => tab === 'all' || a.status === (tab === 'acknowledged' ? 'acknowledged' : tab === 'dismissed' ? 'dismissed' : 'open')), [alerts, tab]);
  const current = alerts.find((a) => a.id === sel) ?? shown[0] ?? null;

  useEffect(() => {
    if (shown.length && !shown.some((a) => a.id === sel)) setSel(shown[0]?.id ?? null);
  }, [shown, sel, setSel]);

  useExportProvider(() => ({
    name: 'anomalies',
    rows: shown.map((a) => ({ id: a.id, principal: a.principal, role: a.role, day: a.day, isolationScore: +a.score.toFixed(3), status: a.status, summary: a.summary, ...Object.fromEntries(FEATURES.map((f, i) => [f, +(a.features[i] ?? 0).toFixed(3)])) })),
    summary: { open: alerts.filter((a) => a.status === 'open').length, model: 'Isolation Forest (120 trees, seeded)' },
  }));

  const act = async (a: AnomalyAlert, status: 'acknowledged' | 'dismissed'): Promise<void> => {
    try {
      await api.actOnAlert(a.id, status, actor);
      await qc.invalidateQueries({ queryKey: ['anomalies'] });
      notify({ title: `Alert ${a.id} ${status}`, body: `${a.principal}: ${a.summary}`, undo: () => { void api.actOnAlert(a.id, 'open', actor).then(() => qc.invalidateQueries({ queryKey: ['anomalies'] })); } });
    } catch (e) {
      notify({ title: 'Could not update the alert', body: describeError(e).message, intent: 'error' });
    }
  };

  const columns = useMemo<Column<AnomalyAlert>[]>(() => [
    { id: 'id', header: 'Alert', width: 90, sortValue: (a) => a.id, cell: (a) => <strong className="sm-mono">{a.id}</strong>, card: 'title' },
    { id: 'principal', header: 'Principal', width: 130, sortValue: (a) => a.principal, cell: (a) => a.principal },
    { id: 'role', header: 'Role', width: 120, cell: (a) => <RoleChip role={a.role} /> },
    { id: 'day', header: 'Day (IST)', width: 110, sortValue: (a) => a.day, cell: (a) => <span className="sm-num">{a.day}</span> },
    { id: 'score', header: 'Isolation score', width: 190, sortValue: (a) => a.score, cell: (a) => <ScoreBar s={a.score} /> },
    { id: 'summary', header: 'Why flagged', width: 360, cell: (a) => <span title={a.summary}>{a.summary}</span> },
    { id: 'status', header: 'Status', width: 130, sortValue: (a) => a.status, cell: (a) => <Chip tone={a.status === 'open' ? 'warn' : a.status === 'acknowledged' ? 'ok' : 'neutral'}>{a.status}</Chip> },
    {
      id: 'act', header: 'Actions', width: 250, card: 'hide',
      cell: (a) => (
        <span className="sm-row" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <Button size="small" icon={<Checkmark24Regular />} disabled={a.status !== 'open'} onClick={() => void act(a, 'acknowledged')}>Acknowledge</Button>
          <Button size="small" icon={<Dismiss24Regular />} disabled={a.status !== 'open'} onClick={() => setConfirm(a)}>Dismiss</Button>
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [actor]);
  const [sortRaw, setSortRaw] = useParam('sort', 'score:desc');
  const sort = sortRaw ? { id: sortRaw.split(':')[0] as string, desc: sortRaw.endsWith(':desc') } : null;

  return (
    <ViewFrame
      title="Anomalies"
      icon={<Alert24Regular />}
      subtitle="An Isolation Forest scores each principal-day on six behaviour features. It raises alerts and recommends; it never changes a masking decision."
    >
      <Region machine={m} skeleton={<div className="sm-stack"><CardsSkeleton count={3} height={90} /><TableSkeleton rows={4} height={260} /></div>} empty={<EmptyPanel title="No anomalies detected">The model has not flagged any principal-day. New alerts appear as audit events arrive.</EmptyPanel>}>
        <div className="sm-stack" style={{ gap: 16 }}>
          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(String(d.value), true)} aria-label="Alert status">
            <Tab value="open">Open ({alerts.filter((a) => a.status === 'open').length})</Tab>
            <Tab value="acknowledged">Acknowledged ({alerts.filter((a) => a.status === 'acknowledged').length})</Tab>
            <Tab value="dismissed">Dismissed ({alerts.filter((a) => a.status === 'dismissed').length})</Tab>
            <Tab value="all">All ({alerts.length})</Tab>
          </TabList>
          {shown.length === 0 ? (
            <EmptyPanel title={tab === 'open' ? 'All alerts handled' : 'Nothing here'}>{tab === 'open' ? 'Every open alert has been acknowledged or dismissed.' : 'No alerts have this status.'}</EmptyPanel>
          ) : (
            <DataTable<AnomalyAlert>
              rows={shown}
              columns={columns}
              getId={(a) => a.id}
              ariaLabel="Anomaly alerts"
              sort={sort}
              onSortChange={(s) => setSortRaw(s ? `${s.id}:${s.desc ? 'desc' : 'asc'}` : null)}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              density={density}
              activeId={current?.id}
              height={Math.min(420, 120 + shown.length * (density === 'compact' ? 28 : 36))}
              onOpen={(a) => { setSel(a.id); setParams({ open: `alert:${a.id}`, dtab: null }, { replace: false }); }}
              bulkActions={(rows, clear) => (
                <Button size="small" appearance="primary" onClick={async () => { for (const a of rows.filter((x) => x.status === 'open')) await api.actOnAlert(a.id, 'acknowledged', actor); clear(); await qc.invalidateQueries({ queryKey: ['anomalies'] }); notify({ title: `Acknowledged ${rows.length} alert(s)` }); }}>Acknowledge selected</Button>
              )}
            />
          )}
          {current && (
            <div className="sm-grid">
              <div className="sm-col-6"><RadarPanel a={current} /></div>
              <div className="sm-card sm-col-6 sm-stack">
                <div className="sm-card-head" style={{ marginBottom: 0 }}>
                  <h2 className="t-subtitle1" style={{ margin: 0 }}>{current.id} · {current.principal}</h2>
                  <Button size="small" icon={<Open24Regular />} onClick={() => setParams({ open: `alert:${current.id}`, dtab: null }, { replace: false })}>Open details</Button>
                </div>
                <p style={{ margin: 0 }}>{current.summary}.</p>
                <table className="sm-matrix" aria-label="Feature values">
                  <thead><tr><th scope="col">Feature</th><th scope="col">This day</th><th scope="col">Own median</th><th scope="col">Fleet P95</th></tr></thead>
                  <tbody>{FEATURES.map((f, i) => <tr key={f}><td>{f}</td><td className="sm-num"><strong>{fmtFeature(f, current.features[i] ?? 0)}</strong></td><td className="sm-num">{fmtFeature(f, current.baseline[i] ?? 0)}</td><td className="sm-num">{fmtFeature(f, current.fleetP95[i] ?? 0)}</td></tr>)}</tbody>
                </table>
                <p className="t-caption1 t-secondary" style={{ margin: 0 }}>First event {fmtTime(current.firstSeen)} · {current.eventIds.length} audit events. Scores near 1 are easy to isolate; near 0.5 are ordinary.</p>
              </div>
            </div>
          )}
        </div>
      </Region>
      <Dialog open={confirm !== null} onOpenChange={(_, d) => !d.open && setConfirm(null)} modalType="alert">
        <DialogSurface className="sm-acrylic" style={{ borderRadius: 'var(--sm-r-dlg)', boxShadow: 'var(--sm-shadow28)' }}>
          <DialogBody>
            <DialogTitle>Dismiss alert {confirm?.id}?</DialogTitle>
            <DialogContent>Dismissing removes {confirm?.principal}’s alert from the open list and records the action in the audit trail. You can undo from the confirmation toast.</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button appearance="primary" onClick={() => { const a = confirm; setConfirm(null); if (a) void act(a, 'dismissed'); }}>Dismiss alert</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </ViewFrame>
  );
}
