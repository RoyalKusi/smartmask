import { createRng, type Rng } from './prng';

type TreeNode = { leaf: true; size: number } | { leaf: false; feature: number; split: number; l: TreeNode; r: TreeNode };

const EULER = 0.5772156649;
const c = (n: number): number => (n <= 1 ? 0 : n === 2 ? 1 : 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n);

function build(rows: number[][], depth: number, limit: number, rng: Rng): TreeNode {
  if (depth >= limit || rows.length <= 1) return { leaf: true, size: rows.length };
  const dims = (rows[0] as number[]).length;
  for (let attempt = 0; attempt < 6; attempt++) {
    const f = rng.int(0, dims - 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      const v = r[f] as number;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi > lo) {
      const split = rng.float(lo, hi);
      return {
        leaf: false,
        feature: f,
        split,
        l: build(rows.filter((r) => (r[f] as number) < split), depth + 1, limit, rng),
        r: build(rows.filter((r) => (r[f] as number) >= split), depth + 1, limit, rng),
      };
    }
  }
  return { leaf: true, size: rows.length };
}

function pathLength(x: readonly number[], node: TreeNode, depth: number): number {
  if (node.leaf) return depth + c(node.size);
  return pathLength(x, (x[node.feature] as number) < node.split ? node.l : node.r, depth + 1);
}

export interface IsolationForest {
  score(x: readonly number[]): number;
}

/** Isolation Forest (Liu et al.). Scores near 1 are anomalous, near 0.5 are ordinary. */
export function trainIsolationForest(data: number[][], opts: { trees?: number; sample?: number; seed?: number } = {}): IsolationForest {
  const rng = createRng(opts.seed ?? 7);
  const trees = opts.trees ?? 100;
  const psi = Math.min(opts.sample ?? 256, data.length);
  const limit = Math.ceil(Math.log2(Math.max(psi, 2)));
  const forest: TreeNode[] = [];
  for (let t = 0; t < trees; t++) {
    const sample: number[][] = [];
    for (let i = 0; i < psi; i++) sample.push(data[rng.int(0, data.length - 1)] as number[]);
    forest.push(build(sample, 0, limit, rng));
  }
  const norm = c(psi);
  return {
    score(x) {
      const avg = forest.reduce((a, t) => a + pathLength(x, t, 0), 0) / forest.length;
      return Math.pow(2, -avg / norm);
    },
  };
}
