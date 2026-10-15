/** Fixed demo clock so every run is identical. */
export const DEMO_NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
export const DAY = 86_400_000;

export const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
export const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const money = (n: number): string => n.toFixed(2);
