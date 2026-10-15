import { Button, Tab, TabList } from '@fluentui/react-components';
import { Gauge24Regular, ArrowSync24Regular } from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { describeError } from '../../shared/api/errors';
import { api, liveCache } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import type { PerformanceData } from '../../shared/api/types';
import { P99_CEILING_MS, STAGE_BUDGET_MS } from '../../shared/engine/pipeline';
import { CACHE_BASELINE } from '../../shared/data/telemetry';
import { ChartFrame, useChartColors } from '../../shared/ui/ChartFrame';
import { Chip } from '../../shared/ui/Chips';
import { Gauge } from '../../shared/ui/Gauge';
import { fmtInt, fmtPct } from '../../shared/ui/format';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { ChartSkeleton, Skel } from '../../shared/ui/Skeleton';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { usePerformance } from '../../app/queries';
import { useParam, useRole } from '../../app/router';

const RANGES: Record<string, { label: string; hours: number }> = { '24h': { label: 'Last 24 hours', hours: 24 }, '7d': { label: 'Last 7 days', hours: 168 }, '14d': { label: 'Last 14 days', hours: 336 } };
const hourLabel = (ms: number): string => new Date(ms).toISOString().slice(5, 13).replace('T', ' ') + ':00';

function useLiveCache() {
  const [pts, setPts] = useState<{ s: number; ratio: number; label: string }[]>([]);
  useEffect(() => {
    const sample = (): void => {
      const c = liveCache();
      setPts((prev) => [...prev, { s: prev.length ? (prev[prev.length - 1] as { s: number }).s + 1 : 0, ratio: c.ratio, label: c.sinceBump === null ? 'steady' : `${Math.round(c.sinceBump / 60)} sim. min since bump` }].slice(-90));
    };
    sample();
    const id = window.setInterval(sample, 1000);
    return () => window.clearInterval(id);
  }, []);
  return pts;
}

function Body({ d }: { d: PerformanceData }) {
  const colors = useChartColors();
  const [range, setRange] = useParam('range', '7d');
  const hours = RANGES[range]?.hours ?? 168;
  const slice = useMemo(() => d.hours.slice(-hours), [d.hours, hours]);
  const live = useLiveCache();
  const tip = { background: colors.bgSurface, border: `1px solid ${colors.strokeDefault}`, borderRadius: 8, color: colors.fgPrimary };
  const axis = { fill: colors.fgTertiary, fontSize: 12 };
  const stageColors = [colors.chartSupport, colors.tagFinancial, colors.tagPiiMedium, colors.success, colors.chartNeutral];
  const stages = (['parse', 'policy', 'mutation', 'render', 'audit'] as const).map((k, i) => ({ k, v: d.stageMeans[k], c: stageColors[i] as string }));
  let offset = 0;
  const waterfall = stages.map((s) => {
    const row = { stage: s.k, offset, value: Number(s.v.toFixed(3)), color: s.c };
    offset += s.v;
    return row;
  });
  const total = offset;
  const cacheNow = live[live.length - 1]?.ratio ?? CACHE_BASELINE;
  const cacheSeries = d.cacheSeries.slice(-hours).map((c) => ({ label: hourLabel(c.t), t: c.t, ratio: Number((c.ratio * 100).toFixed(2)) }));

  return (
    <div className="sm-stack" style={{ gap: 16 }}>
      <div className="sm-row" style={{ justifyContent: 'space-between' }}>
        <TabList selectedValue={range} onTabSelect={(_, v) => setRange(String(v.value), true)} aria-label="Time range">
          {Object.entries(RANGES).map(([k, v]) => <Tab key={k} value={k}>{v.label}</Tab>)}
        </TabList>
        <Chip tone="neutral">All latency figures are simulated, not measured benchmarks</Chip>
      </div>

      <div className="sm-grid">
        <div className="sm-card sm-col-4" style={{ display: 'grid', placeItems: 'center' }}>
          <Gauge value={d.p99} max={P99_CEILING_MS} warnAt={STAGE_BUDGET_MS} badAt={P99_CEILING_MS} label="P99 overhead against the 5 millisecond ceiling" display={`${d.p99.toFixed(2)} ms`} caption={`P99 of ${fmtInt(d.hours.reduce((s, h) => s + h.total, 0))} events · ceiling ${P99_CEILING_MS.toFixed(1)} ms`} size={220} />
        </div>
        <div className="sm-card sm-col-4">
          <div className="t-caption1 t-secondary">Latency percentiles (simulated)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
            {([['P50', d.p50], ['P95', d.p95], ['P99', d.p99]] as const).map(([k, v]) => (
              <div key={k}><div className="t-caption1 t-tertiary">{k}</div><div className="t-title2 sm-num">{v.toFixed(2)}</div><div className="t-caption1 t-tertiary">ms</div></div>
            ))}
          </div>
          <p className="t-caption1 t-secondary" style={{ marginBottom: 0 }}>Budget {STAGE_BUDGET_MS.toFixed(1)} ms per query; occasional spikes reach 4.6 ms and never cross {P99_CEILING_MS.toFixed(1)} ms.</p>
        </div>
        <div className="sm-card sm-col-4">
          <div className="t-caption1 t-secondary">Plan-cache hit ratio</div>
          <div className="t-display sm-num" style={{ color: cacheNow < 0.8 ? 'var(--sm-warning)' : undefined }}>{fmtPct(cacheNow, 1)}</div>
          <div className="t-secondary">14-day mean {fmtPct(d.cacheAvg, 1)} · baseline ≈ {fmtPct(CACHE_BASELINE)}</div>
          <div className="t-caption1 t-tertiary">{d.bumpsLive > 0 ? `${d.bumpsLive} policy publish(es) this session` : 'Publish a policy version to see the cache dip and recover.'}</div>
        </div>

        <div className="sm-col-6">
          <ChartFrame
            title="Stage latency waterfall (mean)"
            description={`Waterfall of mean overhead by stage across all audited queries. Total ${total.toFixed(2)} milliseconds.`}
            height={250}
            table={{ columns: ['Stage', 'Start (ms)', 'Duration (ms)'], rows: waterfall.map((w) => [w.stage, w.offset.toFixed(3), w.value.toFixed(3)]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfall} layout="vertical" margin={{ left: 16, right: 24, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke={colors.strokeSubtle} horizontal={false} />
                <XAxis type="number" domain={[0, Math.max(total * 1.1, STAGE_BUDGET_MS)]} tick={axis} unit=" ms" stroke={colors.fgTertiary} />
                <YAxis type="category" dataKey="stage" tick={axis} width={74} stroke={colors.fgTertiary} />
                <Tooltip contentStyle={tip} formatter={(v, n) => (n === 'offset' ? [`${Number(v).toFixed(3)} ms`, 'starts at'] : [`${Number(v).toFixed(3)} ms`, 'duration'])} />
                <ReferenceLine x={STAGE_BUDGET_MS} stroke={colors.danger} strokeDasharray="4 3" label={{ value: 'budget 4.0', fill: colors.danger, fontSize: 11, position: 'insideTopRight' }} />
                <Bar dataKey="offset" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="value" stackId="w" radius={3}>{waterfall.map((w) => <Cell key={w.stage} fill={w.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="sm-col-6">
          <ChartFrame
            title="P50 / P95 / P99 overhead by hour"
            description="Line chart of hourly percentiles of engine overhead in milliseconds, with reference lines at the 4.0 ms budget and the 5.0 ms ceiling."
            height={250}
            table={{ columns: ['Hour (UTC)', 'Events', 'P50', 'P95', 'P99'], rows: slice.filter((h) => h.total > 0).slice(-60).map((h) => [hourLabel(h.start), h.total, h.p50.toFixed(2), h.p95.toFixed(2), h.p99.toFixed(2)]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={slice.map((h) => ({ label: hourLabel(h.start), p50: h.total ? Number(h.p50.toFixed(2)) : null, p95: h.total ? Number(h.p95.toFixed(2)) : null, p99: h.total ? Number(h.p99.toFixed(2)) : null }))} margin={{ left: -12, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke={colors.strokeSubtle} vertical={false} />
                <XAxis dataKey="label" tick={axis} interval={Math.floor(slice.length / 5)} stroke={colors.fgTertiary} />
                <YAxis domain={[0, 5.5]} tick={axis} unit=" ms" stroke={colors.fgTertiary} />
                <Tooltip contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={P99_CEILING_MS} stroke={colors.danger} label={{ value: 'ceiling 5.0', fill: colors.danger, fontSize: 11, position: 'insideTopRight' }} />
                <ReferenceLine y={STAGE_BUDGET_MS} stroke={colors.warning} strokeDasharray="4 3" />
                <Line type="monotone" dataKey="p50" stroke={colors.chartSupport} dot={false} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="p95" stroke={colors.chartAnalyst} dot={false} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="p99" stroke={colors.tagPiiMedium} dot={false} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="sm-col-6">
          <ChartFrame
            title="Cache-hit ratio (hourly mean)"
            description="Area chart of the plan-cache hit ratio per hour. Dips follow each policy_version publish and recover within minutes."
            height={240}
            table={{ columns: ['Hour (UTC)', 'Hit ratio %'], rows: cacheSeries.filter((_, i) => i % 6 === 0).map((c) => [c.label, c.ratio]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cacheSeries} margin={{ left: -12, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke={colors.strokeSubtle} vertical={false} />
                <XAxis dataKey="label" tick={axis} interval={Math.floor(cacheSeries.length / 5)} stroke={colors.fgTertiary} />
                <YAxis domain={[60, 100]} tick={axis} unit="%" stroke={colors.fgTertiary} />
                <Tooltip contentStyle={tip} />
                {d.policyBumps.filter((b) => cacheSeries.some((c) => Math.abs(c.t - b) < 3_600_000)).map((b) => {
                  const hit = cacheSeries.reduce((best, c) => (Math.abs(c.t - b) < Math.abs(best.t - b) ? c : best), cacheSeries[0] as (typeof cacheSeries)[number]);
                  return <ReferenceLine key={b} x={hit.label} stroke={colors.tagFinancial} strokeDasharray="3 3" label={{ value: 'policy', fill: colors.tagFinancial, fontSize: 11, position: 'insideTop' }} />;
                })}
                <Area type="monotone" dataKey="ratio" stroke={colors.success} fill={colors.success} fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="sm-col-6">
          <ChartFrame
            title="Live cache after a policy publish"
            description="Live line chart sampled every second. A policy publish invalidates the plan cache; the hit ratio drops, then recovers (time accelerated 8×)."
            height={240}
            table={{ columns: ['Second', 'Hit ratio %', 'State'], rows: live.filter((_, i) => i % 5 === 0).map((p) => [p.s, (p.ratio * 100).toFixed(1), p.label]) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={live.map((p) => ({ s: p.s, ratio: Number((p.ratio * 100).toFixed(1)) }))} margin={{ left: -12, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke={colors.strokeSubtle} vertical={false} />
                <XAxis dataKey="s" tick={axis} stroke={colors.fgTertiary} unit="s" />
                <YAxis domain={[20, 100]} tick={axis} unit="%" stroke={colors.fgTertiary} />
                <Tooltip contentStyle={tip} />
                <ReferenceLine y={CACHE_BASELINE * 100} stroke={colors.fgTertiary} strokeDasharray="4 3" />
                <Line type="monotone" dataKey="ratio" stroke={colors.chartSupport} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </div>
    </div>
  );
}

function PerfSkeleton() {
  return (
    <div className="sm-grid" role="status" aria-busy="true" aria-label="Loading performance">
      {[0, 1, 2].map((i) => <div key={i} className="sm-card sm-col-4" style={{ height: 190 }}><Skel w="40%" h={12} /><div style={{ height: 14 }} /><Skel w="60%" h={40} /></div>)}
      {[0, 1, 2, 3].map((i) => <div key={i} className="sm-card sm-col-6" style={{ height: 340 }}><Skel w="45%" h={16} /><div style={{ height: 10 }} /><ChartSkeleton height={250} /></div>)}
    </div>
  );
}

export default function PerformanceView() {
  const q = usePerformance();
  const m = useLoadMachine(q, (d) => d.hours.length === 0);
  const qc = useQueryClient();
  const notify = useNotify();
  const role = useRole();
  const [busy, setBusy] = useState(false);

  useExportProvider(() => ({
    name: 'performance',
    rows: (q.data?.hours ?? []).filter((h) => h.total > 0).map((h) => ({ hour_utc: new Date(h.start).toISOString(), events: h.total, p50_ms_simulated: +h.p50.toFixed(3), p95_ms_simulated: +h.p95.toFixed(3), p99_ms_simulated: +h.p99.toFixed(3), parse: +h.stages.parse.toFixed(3), policy: +h.stages.policy.toFixed(3), mutation: +h.stages.mutation.toFixed(3), render: +h.stages.render.toFixed(3), audit: +h.stages.audit.toFixed(3) })),
    summary: { note: 'Simulated latency, not a benchmark', p50: q.data?.p50, p95: q.data?.p95, p99: q.data?.p99, cacheMean: q.data?.cacheAvg },
  }));

  const republish = async (): Promise<void> => {
    setBusy(true);
    try {
      const p = await api.policy();
      const { version } = await api.savePolicy(p.text, DEFAULT_PRINCIPAL[role], 'Re-published unchanged to demonstrate plan-cache invalidation.');
      await qc.invalidateQueries();
      notify({ title: `Policy v${version} published`, body: 'Cache invalidated. Watch the live chart dip and recover.' });
    } catch (e) {
      notify({ title: 'Could not republish', body: describeError(e).message, intent: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ViewFrame
      title="Performance"
      icon={<Gauge24Regular />}
      subtitle="Where the overhead goes, per stage and per percentile. Figures are simulated from a seeded model."
      commands={<Button icon={<ArrowSync24Regular />} disabled={busy} onClick={() => void republish()}>Republish policy to invalidate cache</Button>}
    >
      <Region machine={m} skeleton={<PerfSkeleton />} empty={<EmptyPanel title="No timing data yet">Run a query in the Workbench to record the first timings.</EmptyPanel>}>
        {q.data && <Body d={q.data} />}
      </Region>
    </ViewFrame>
  );
}
