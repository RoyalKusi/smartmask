import { describe, expect, it } from 'vitest';
import { trainIsolationForest } from '../../src/shared/engine/iforest';
import { createRng, mulberry32 } from '../../src/shared/engine/prng';

describe('isolation forest', () => {
  it('scores an outlier higher than inliers, deterministically', () => {
    const rng = createRng(3);
    const data = Array.from({ length: 300 }, () => [rng.normal(), rng.normal(), rng.normal()]);
    const f = trainIsolationForest(data, { trees: 100, seed: 5 });
    const g = trainIsolationForest(data, { trees: 100, seed: 5 });
    const inlier = f.score([0.1, -0.2, 0.05]);
    const outlier = f.score([6, 7, -6]);
    expect(outlier).toBeGreaterThan(0.65);
    expect(inlier).toBeLessThan(0.55);
    expect(g.score([6, 7, -6])).toBe(outlier);
  });
});

describe('mulberry32', () => {
  it('is reproducible and well distributed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});
