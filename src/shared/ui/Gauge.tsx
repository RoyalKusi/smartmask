import type { ReactNode } from 'react';

/** Half-ring gauge with accessible meter semantics. `tone` follows the value against thresholds. */
export function Gauge({
  value,
  max,
  label,
  display,
  warnAt,
  badAt,
  size = 160,
  caption,
}: {
  value: number;
  max: number;
  label: string;
  display: ReactNode;
  warnAt?: number;
  badAt?: number;
  size?: number;
  caption?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const circ = Math.PI * r;
  const tone =
    badAt !== undefined && value >= badAt
      ? 'var(--sm-danger)'
      : warnAt !== undefined && value >= warnAt
        ? 'var(--sm-warning)'
        : 'var(--sm-success)';
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      style={{ width: size, textAlign: 'center' }}
    >
      <svg width={size} height={size / 2 + 16} viewBox={`0 0 ${size} ${size / 2 + 16}`} aria-hidden>
        <path d={arc} fill="none" stroke="var(--sm-stroke-subtle)" strokeWidth={12} strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={tone}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          style={{ transition: 'stroke-dasharray 400ms cubic-bezier(0.1, 0.9, 0.2, 1)' }}
        />
      </svg>
      <div style={{ marginTop: -44 }}>
        <div className="t-title2 sm-num">{display}</div>
        {caption && <div className="t-caption1 t-tertiary">{caption}</div>}
      </div>
    </div>
  );
}

/** Circular progress ring used by scans. */
export function ProgressRing({ pct, size = 44, label }: { pct: number; size?: number; label: string }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      style={{ width: size, height: size, position: 'relative' }}
    >
      <svg width={size} height={size} aria-hidden style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--sm-stroke-subtle)"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--sm-brand)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          style={{ transition: 'stroke-dasharray 150ms linear' }}
        />
      </svg>
      <span
        className="t-caption1 sm-num"
        style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 600 }}
      >
        {Math.round(pct)}
      </span>
    </div>
  );
}

export function MiniBar({ value, kind, label }: { value: number; kind: 'n' | 'p' | 'e'; label: string }) {
  return (
    <div
      className="sm-mb"
      role="img"
      aria-label={`${label} ${value.toFixed(2)}`}
      title={`${label} ${value.toFixed(2)}`}
    >
      <i data-k={kind} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** N / P / E contributions as three stacked mini-bars. */
export function NpeBars({ n, p, e }: { n: number; p: number; e: number }) {
  return (
    <div className="sm-minibar" style={{ gap: 3 }}>
      <MiniBar value={n} kind="n" label="N name" />
      <MiniBar value={p} kind="p" label="P pattern" />
      <MiniBar value={e} kind="e" label="E entropy" />
    </div>
  );
}
