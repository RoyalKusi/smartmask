import type { CSSProperties } from 'react';

export function Skel({
  w = '100%',
  h = 14,
  r,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  style?: CSSProperties;
}) {
  return <span className="sm-skel" aria-hidden style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function TableSkeleton({ rows = 10, height }: { rows?: number; height?: number }) {
  return (
    <div
      className="sm-table"
      aria-busy="true"
      aria-label="Loading table"
      role="status"
      style={height ? { height } : undefined}
    >
      <div className="sm-thead" style={{ width: '100%' }}>
        {[22, 14, 12, 18, 14, 10].map((w, i) => (
          <div className="sm-th" key={i} style={{ width: `${w}%` }}>
            <Skel w="60%" h={10} />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '0 12px',
            borderBottom: '1px solid var(--sm-stroke-subtle)',
          }}
        >
          {[22, 14, 12, 18, 14, 10].map((w, j) => (
            <span key={j} style={{ width: `${w}%` }}>
              <Skel h={12} w={`${50 + ((i * 7 + j * 13) % 45)}%`} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({
  count = 4,
  height = 120,
  min = 260,
}: {
  count?: number;
  height?: number;
  min?: number;
}) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 16 }}
      aria-busy="true"
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, i) => (
        <div className="sm-card" key={i} style={{ height }}>
          <Skel w="50%" h={14} />
          <div style={{ height: 12 }} />
          <Skel h={10} />
          <div style={{ height: 8 }} />
          <Skel w="80%" h={10} />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading chart"
      style={{ height, display: 'flex', alignItems: 'flex-end', gap: 6, paddingTop: 8 }}
    >
      {Array.from({ length: 24 }, (_, i) => (
        <Skel key={i} w="100%" h={`${30 + ((i * 37) % 60)}%`} />
      ))}
    </div>
  );
}
