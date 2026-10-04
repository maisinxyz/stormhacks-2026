// PRD 1.2 step 5: opacity crop, floater removal, center/orient (face +Z, feet y=0), normalize scale, decimate.
import type { Species } from '@fetch/contracts';
import { type Gaussians, subset } from './gaussians';

export interface CleanupOptions { species: Species; budget: number; minAlpha?: number }

const percentile = (a: Float32Array, p: number) => Float32Array.from(a).sort()[Math.min(a.length - 1, Math.floor(a.length * p))];

// ponytail: floaters = splats with few neighbours in a uniform grid (not true kNN statistics); swap for kNN if quality score demands it.
function removeFloaters(g: Gaussians): Gaussians {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.pos[i * 3 + k]); mx[k] = Math.max(mx[k], g.pos[i * 3 + k]); }
  const cell = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 48 || 1;
  const key = (x: number, y: number, z: number) => x * 73856093 ^ y * 19349663 ^ z * 83492791;
  const grid = new Map<number, number>();
  const cid = (i: number) => [0, 1, 2].map(k => Math.floor((g.pos[i * 3 + k] - mn[k]) / cell));
  for (let i = 0; i < g.n; i++) { const [a, b, c] = cid(i); const k = key(a, b, c); grid.set(k, (grid.get(k) ?? 0) + 1); }
  const keep: number[] = [];
  for (let i = 0; i < g.n; i++) {
    const [a, b, c] = cid(i);
    let cnt = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) cnt += grid.get(key(a + dx, b + dy, c + dz)) ?? 0;
    if (cnt >= 12) keep.push(i);
  }
  return subset(g, keep);
}

// ponytail: assumes +Y up and doesn't resolve head vs tail direction; add a skew/face heuristic if models come out backwards.
function centerOrient(g: Gaussians, species: Species): Gaussians {
  const ys = new Float32Array(g.n);
  let cx = 0, cz = 0;
  for (let i = 0; i < g.n; i++) { ys[i] = g.pos[i * 3 + 1]; cx += g.pos[i * 3]; cz += g.pos[i * 3 + 2]; }
  cx /= g.n; cz /= g.n;
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < g.n; i++) { const x = g.pos[i * 3] - cx, z = g.pos[i * 3 + 2] - cz; sxx += x * x; szz += z * z; sxz += x * z; }
  let phi = 0.5 * Math.atan2(2 * sxz, sxx - szz); // major horizontal axis
  if (species === 'bird') phi += Math.PI / 2;      // bird: wingspan is the major axis, body points along the minor
  const th = phi - Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const y0 = percentile(ys, 0.01), height = (percentile(ys, 0.99) - y0) || 1, k = 1 / height;
  const qw = Math.cos(th / 2), qy = Math.sin(th / 2); // yaw quaternion
  for (let i = 0; i < g.n; i++) {
    const x = g.pos[i * 3] - cx, z = g.pos[i * 3 + 2] - cz;
    g.pos[i * 3] = (x * c + z * s) * k;
    g.pos[i * 3 + 1] = (g.pos[i * 3 + 1] - y0) * k;
    g.pos[i * 3 + 2] = (-x * s + z * c) * k;
    for (let a = 0; a < 3; a++) g.scale[i * 3 + a] *= k;
    const [w, x1, y1, z1] = [g.rot[i * 4], g.rot[i * 4 + 1], g.rot[i * 4 + 2], g.rot[i * 4 + 3]];
    // q' = qyaw * q, qyaw = (qw, 0, qy, 0)
    g.rot.set([qw * w - qy * y1, qw * x1 + qy * z1, qw * y1 + qy * w, qw * z1 - qy * x1], i * 4);
  }
  return g;
}

function decimate(g: Gaussians, budget: number, seed = 7): Gaussians {
  if (g.n <= budget) return g;
  const idx = Uint32Array.from({ length: g.n }, (_, i) => i);
  let r = seed;
  for (let i = g.n - 1; i > 0; i--) { r = (r * 1664525 + 1013904223) >>> 0; const j = r % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const out = subset(g, idx.subarray(0, budget));
  const grow = Math.cbrt(g.n / budget); // keep surface coverage after dropping splats
  for (let i = 0; i < out.scale.length; i++) out.scale[i] *= grow;
  return out;
}

export function cleanupSplat(g: Gaussians, o: CleanupOptions): Gaussians {
  const min = o.minAlpha ?? 26;
  const keep: number[] = [];
  for (let i = 0; i < g.n; i++) if (g.rgba[i * 4 + 3] >= min) keep.push(i);
  return decimate(centerOrient(removeFloaters(subset(g, keep)), o.species), o.budget);
}

export const MAIN_BUDGET = 300_000, PEEK_BUDGET = 80_000;
