/** Seeded PRNG (mulberry32) plus convenience samplers. Every run is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  normal(): number;
  logNormal(mu: number, sigma: number): number;
  digits(n: number): string;
  fork(label: string): Rng;
}

export function createRng(seed: number | string): Rng {
  const base = typeof seed === 'string' ? hashSeed(seed) : seed;
  const next = mulberry32(base);
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)] as never,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [item, w] of items) {
        r -= w;
        if (r <= 0) return item;
      }
      return (items[items.length - 1] as readonly [never, number])[0];
    },
    normal: () => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    logNormal: (mu, sigma) => Math.exp(mu + sigma * rng.normal()),
    digits: (n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += Math.floor(next() * 10);
      return s;
    },
    fork: (label) => createRng(base ^ hashSeed(label)),
  };
  return rng;
}
