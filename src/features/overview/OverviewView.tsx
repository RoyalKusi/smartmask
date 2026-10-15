import { Button } from '@fluentui/react-components';
import { ArrowSync24Regular, DataPie24Regular } from '@fluentui/react-icons';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useQueryClient } from '@tanstack/react-query';
import type { ActivityItem, OverviewData } from '../../shared/api/types';
import { navigate, useRole } from '../../app/router';
import { useOverview } from '../../app/queries';
import { ChartFrame, useChartColors } from '../../shared/ui/ChartFrame';
import { CountUp } from '../../shared/ui/CountUp';
import { fmtTime } from '../../shared/ui/format';
import { ChartSkeleton, Skel } from '../../shared/ui/Skeleton';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useReducedMotion } from '../../shared/ui/useMedia';
import { Chip } from '../../shared/ui/Chips';

const KIND_VIEW: Record<ActivityItem['kind'], () => void> = {
  scan: () => navigate('discovery'),
  policy: () => navigate('policy'),
  review: () => navigate('review'),
  role: () => navigate('audit'),
  alert: () => navigate('anomalies'),
  query: () => navigate('workbench'),
  export: () => navigate('audit'),
  backend: () => navigate('discovery'),
  audit: () => navigate('audit'),
  drift: () => navigate('discovery'),
};
const TONE: Record<ActivityItem['tone'], string> = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'brand' };

function Kpi({
  label,
  children,
  hint,
  onClick,
  caption,
}: {
  label: string;
  children: React.ReactNode;
  hint: string;
  onClick: () => void;
  caption?: string;
}) {
  return (
    <button
      className="sm-card sm-kpi sm-col-3"
      onClick={onClick}
      aria-label={`${label}: ${hint}. Open details`}
      style={{ cursor: 'pointer' }}
    >
      <div className="t-caption1 t-secondary">{label}</div>
      <div className="t-display">{children}</div>
      <div className="t-caption1 t-tertiary">{caption ?? hint}</div>
    </button>
  );
}

function OverviewSkeleton() {
  return (
    <div className="sm-grid" aria-busy="true" role="status" aria-label="Loading overview">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="sm-card sm-col-3" style={{ height: 124 }}>
          <Skel w="55%" h={12} />
          <div style={{ height: 16 }} />
          <Skel w="40%" h={40} />
          <div style={{ height: 10 }} />
          <Skel w="70%" h={10} />
        </div>
      ))}
      <div className="sm-card sm-col-8" style={{ height: 356 }}>
        <Skel w="35%" h={16} />
        <div style={{ height: 12 }} />
        <ChartSkeleton height={270} />
      </div>
      <div className="sm-card sm-col-4" style={{ height: 356 }}>
        <Skel w="45%" h={16} />
        <div style={{ height: 12 }} />
        <Skel w="100%" h={250} r={125} style={{ width: 250, margin: '0 auto' }} />
      </div>
      <div className="sm-card sm-col-12" style={{ height: 280 }}>
        <Skel w="25%" h={16} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ marginTop: 18 }}>
            <Skel w={`${60 + i * 6}%`} h={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Body({ d }: { d: OverviewData }) {
  const colors = useChartColors();
  const anim = !useReducedMotion();
  const role = useRole();
  const roleColor = {
    ROLE_ADMIN: colors.chartAdmin,
    ROLE_SUPPORT: colors.chartSupport,
    ROLE_ANALYST: colors.chartAnalyst,
  };
  const tagColor: Record<string, string> = {
    PII_HIGH: colors.tagPiiHigh,
    FINANCIAL_CONFIDENTIAL: colors.tagFinancial,
    PII_MEDIUM: colors.tagPiiMedium,
    CLEAR: colors.chartNeutral,
  };
  const go = (tag: string): void => navigate('discovery', tag === 'CLEAR' ? { state: 'CLEAR' } : { tag });
  return (
    <div className="sm-grid">
      <Kpi label="Columns discovered" hint="across 3 backends" onClick={() => navigate('discovery')}>
        <CountUp value={d.columnsDiscovered} />
      </Kpi>
      <Kpi
        label="ENFORCED columns"
        hint="masked now"
        caption={`${d.review} more in review (masked fail-closed)`}
        onClick={() => navigate('discovery', { state: 'ENFORCED,ENFORCED_ML' })}
      >
        <CountUp value={d.enforced} />
      </Kpi>
      <Kpi
        label="Queries masked in 24 h"
        hint="audited"
        caption="allowed queries, all roles"
        onClick={() => navigate('audit')}
      >
        <CountUp value={d.queries24h} />
      </Kpi>
      <Kpi
        label="Engine P99 overhead"
        hint="simulated"
        caption="simulated · budget 5.0 ms"
        onClick={() => navigate('performance')}
      >
        <CountUp value={d.p99} decimals={2} suffix=" ms" />
      </Kpi>

      <div className="sm-col-8">
        <ChartFrame
          title="Query volume, last 24 hours"
          description={`Stacked area chart of audited queries per hour by role. ${d.queries24h} allowed queries in the last 24 hours.`}
          height={280}
          table={{
            columns: ['Hour (IST)', 'Admin', 'Support', 'Analyst'],
            rows: d.volume.map((v) => [v.hour, v.ROLE_ADMIN, v.ROLE_SUPPORT, v.ROLE_ANALYST]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={d.volume} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} accessibilityLayer>
              <CartesianGrid stroke={colors.strokeSubtle} vertical={false} />
              <XAxis
                dataKey="hour"
                stroke={colors.fgTertiary}
                tick={{ fill: colors.fgTertiary, fontSize: 12 }}
                interval={3}
              />
              <YAxis
                stroke={colors.fgTertiary}
                tick={{ fill: colors.fgTertiary, fontSize: 12 }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: colors.bgSurface,
                  border: `1px solid ${colors.strokeDefault}`,
                  borderRadius: 8,
                  color: colors.fgPrimary,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {(['ROLE_ADMIN', 'ROLE_SUPPORT', 'ROLE_ANALYST'] as const).map((r) => (
                <Area
                  isAnimationActive={anim}
                  key={r}
                  type="monotone"
                  dataKey={r}
                  name={r.replace('ROLE_', '')}
                  stackId="1"
                  stroke={roleColor[r]}
                  fill={roleColor[r]}
                  fillOpacity={0.35}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <div className="sm-col-4">
        <ChartFrame
          title="Tag distribution"
          description="Donut chart of masked columns by tag. Select a slice or legend entry to open Discovery filtered by that tag."
          height={280}
          table={{ columns: ['Tag', 'Columns'], rows: d.tagDistribution.map((t) => [t.tag, t.count]) }}
        >
          <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer>
                <Pie
                  isAnimationActive={anim}
                  data={d.tagDistribution.filter((t) => t.tag !== 'CLEAR')}
                  dataKey="count"
                  nameKey="tag"
                  innerRadius="58%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke={colors.bgSurface}
                  onClick={(_, i) => go(d.tagDistribution[i]?.tag ?? 'CLEAR')}
                >
                  {d.tagDistribution
                    .filter((t) => t.tag !== 'CLEAR')
                    .map((t) => (
                      <Cell key={t.tag} fill={tagColor[t.tag]} style={{ cursor: 'pointer' }} />
                    ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: colors.bgSurface,
                    border: `1px solid ${colors.strokeDefault}`,
                    borderRadius: 8,
                    color: colors.fgPrimary,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {d.tagDistribution.map((t) => (
                <li key={t.tag}>
                  <button
                    className="sm-nav-item"
                    style={{ height: 28, width: '100%' }}
                    onClick={() => go(t.tag)}
                    aria-label={`${t.tag}: ${t.count} columns. Open in Discovery`}
                  >
                    <span
                      aria-hidden
                      style={{ width: 10, height: 10, borderRadius: 2, background: tagColor[t.tag] }}
                    />
                    <span style={{ fontSize: 12 }}>
                      {t.tag === 'CLEAR' ? 'Untagged (CLEAR, or REVIEW pending)' : t.tag}
                    </span>
                    <span className="sm-nav-badge">{t.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </ChartFrame>
      </div>

      <div className="sm-card sm-col-12">
        <div className="sm-card-head">
          <h2 className="t-subtitle1" style={{ margin: 0 }}>
            Activity
          </h2>
          <span className="t-caption1 t-tertiary">Viewing as {role.replace('ROLE_', '')} · newest first</span>
        </div>
        <ol aria-label="Activity feed" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {d.activity.map((a) => (
            <li key={a.id} style={{ borderTop: '1px solid var(--sm-stroke-subtle)' }}>
              <button
                className="sm-nav-item"
                style={{ height: 'auto', padding: '8px 4px', width: '100%', alignItems: 'flex-start' }}
                onClick={KIND_VIEW[a.kind]}
              >
                <Chip tone={TONE[a.tone]}>{a.kind}</Chip>
                <span style={{ minWidth: 0 }}>
                  <span className="t-body1s" style={{ display: 'block' }}>
                    {a.title}
                  </span>
                  <span className="t-secondary" style={{ display: 'block', whiteSpace: 'normal' }}>
                    {a.detail}
                  </span>
                </span>
                <span
                  className="t-caption1 t-tertiary sm-num"
                  style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                >
                  {fmtTime(a.at)} · {a.actor}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function OverviewView() {
  const q = useOverview();
  const m = useLoadMachine(q, (d) => d.columnsDiscovered === 0);
  const qc = useQueryClient();
  useExportProvider(() => ({
    name: 'overview',
    rows: (q.data?.volume ?? []).map((v) => ({
      hour_ist: v.hour,
      admin: v.ROLE_ADMIN,
      support: v.ROLE_SUPPORT,
      analyst: v.ROLE_ANALYST,
    })),
    summary: q.data
      ? {
          columnsDiscovered: q.data.columnsDiscovered,
          enforced: q.data.enforced,
          queries24h: q.data.queries24h,
          p99OverheadMsSimulated: q.data.p99,
          tagDistribution: q.data.tagDistribution,
        }
      : {},
  }));
  return (
    <ViewFrame
      title="Overview"
      icon={<DataPie24Regular />}
      subtitle="Columns, protection coverage, and query activity for Meridian Savings Bank (synthetic)."
      commands={
        <Button
          icon={<ArrowSync24Regular />}
          onClick={() => void qc.invalidateQueries({ queryKey: ['overview'] })}
        >
          Refresh
        </Button>
      }
    >
      <Region
        machine={m}
        skeleton={<OverviewSkeleton />}
        empty={
          <EmptyPanel title="No columns discovered yet">
            Run a scan from Discovery to populate the catalog.
          </EmptyPanel>
        }
      >
        {q.data && <Body d={q.data} />}
      </Region>
    </ViewFrame>
  );
}
