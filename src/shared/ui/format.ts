export const fmtInt = (n: number): string => n.toLocaleString('en-US');
export const fmtMs = (n: number, d = 2): string => `${n.toFixed(d)} ms`;
export const fmtPct = (n: number, d = 0): string => `${(n * 100).toFixed(d)}%`;
export const shortHash = (h: string | null, n = 10): string => (h ? `${h.slice(0, n)}…` : '—');
export function fmtTime(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts.includes('T') || ts.endsWith('Z') ? ts : `${ts.replace(' ', 'T')}Z`);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`;
}
export function fmtClock(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts.includes('T') || ts.endsWith('Z') ? ts : `${ts.replace(' ', 'T')}Z`);
  return d.toISOString().slice(11, 19);
}
export function ago(ts: string, nowMs: number): string {
  const t = new Date(ts.includes('T') || ts.endsWith('Z') ? ts : `${ts.replace(' ', 'T')}Z`).getTime();
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const roleLabel = (r: string): string => r.replace('ROLE_', '').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function download(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
