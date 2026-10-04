// PRD 1.2 step 5: opacity crop, floater removal, orient (y up, head toward +Z, feet on y=0), normalize, decimate.
// Orientation is done with proper rotations (never mirrors), so each splat's rotation quaternion stays valid.
import type { Species } from '@fetch/contracts';
import { type Gaussians, subset } from './gaussians';

export interface CleanupOptions {
  species: Species;
  budget: number;
  minAlpha?: number;
  /** Coordinate convention of the input. 'trellis': TRELLIS .ply (up = -Y, verified on real output). */
  source?: 'trellis' | 'canonical';
  /** Manual override when the automatic head/tail guess is wrong ("turn around" in the preview UI). */
  flipFacing?: boolean;
}

export interface CleanupInfo {
  /** True if the automatic head detection turned the pet around. */
  turned: boolean;
  /** Head-vs-tail evidence: positive = confident the head is at +Z. */
  headScore: number;
}

type Quat = [number, number, number, number]; // (w, x, y, z)

const percentile = (a: Float32Array, p: number) => Float32Array.from(a).sort()[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];

/** Rotates positions and splat orientations in place by unit quaternion r (about the origin). */
function rotate(g: Gaussians, r: Quat) {
  const [w, x, y, z] = r;
  // rotation matrix rows
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  for (let i = 0; i < g.n; i++) {
    const px = g.pos[i * 3], py = g.pos[i * 3 + 1], pz = g.pos[i * 3 + 2];
    g.pos[i * 3] = m[0] * px + m[1] * py + m[2] * pz;
    g.pos[i * 3 + 1] = m[3] * px + m[4] * py + m[5] * pz;
    g.pos[i * 3 + 2] = m[6] * px + m[7] * py + m[8] * pz;
    const qw = g.rot[i * 4], qx = g.rot[i * 4 + 1], qy = g.rot[i * 4 + 2], qz = g.rot[i * 4 + 3];
    // q' = r * q
    g.rot[i * 4] = w * qw - x * qx - y * qy - z * qz;
    g.rot[i * 4 + 1] = w * qx + x * qw + y * qz - z * qy;
    g.rot[i * 4 + 2] = w * qy - x * qz + y * qw + z * qx;
    g.rot[i * 4 + 3] = w * qz + x * qy - y * qx + z * qw;
  }
}
const yaw = (angle: number): Quat => [Math.cos(angle / 2), 0, Math.sin(angle / 2), 0];

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

/** Center on x/z and turn the major horizontal axis onto Z. */
function alignLongAxis(g: Gaussians, species: Species) {
  let cx = 0, cz = 0;
  for (let i = 0; i < g.n; i++) { cx += g.pos[i * 3]; cz += g.pos[i * 3 + 2]; }
  cx /= g.n; cz /= g.n;
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < g.n; i++) {
    const x = (g.pos[i * 3] -= cx), z = (g.pos[i * 3 + 2] -= cz);
    sxx += x * x; szz += z * z; sxz += x * z;
  }
  let phi = 0.5 * Math.atan2(2 * sxz, sxx - szz); // angle of the major horizontal axis from +X toward +Z
  if (species === 'bird') phi += Math.PI / 2;      // bird: wingspan can be the major axis; body runs along the minor
  // Rotating by +phi about Y maps direction (cos phi, 0, sin phi) onto +X; add 90 deg more to land it on +Z.
  rotate(g, yaw(phi - Math.PI / 2));
}

/**
 * Head-vs-tail evidence along Z for a y-up, length-along-Z body. A head is a dense, high blob at one end;
 * a tail is thinner and usually lower. Returns > 0 when the head looks like it is at +Z.
 */
export function headScore(g: Gaussians): number {
  const zs = new Float32Array(g.n), ys = new Float32Array(g.n);
  for (let i = 0; i < g.n; i++) { zs[i] = g.pos[i * 3 + 2]; ys[i] = g.pos[i * 3 + 1]; }
  const z0 = percentile(zs, 0.01), z1 = percentile(zs, 0.99), y0 = percentile(ys, 0.01), y1 = percentile(ys, 0.99);
  const len = z1 - z0 || 1, h = y1 - y0 || 1, band = 0.22 * len, high = y0 + 0.6 * h;
  let frontHigh = 0, backHigh = 0, frontTop = -Infinity, backTop = -Infinity;
  for (let i = 0; i < g.n; i++) {
    const z = zs[i], y = ys[i];
    if (z > z1 - band) { if (y > high) frontHigh++; frontTop = Math.max(frontTop, y); }
    else if (z < z0 + band) { if (y > high) backHigh++; backTop = Math.max(backTop, y); }
  }
  const mass = (frontHigh - backHigh) / Math.max(1, frontHigh + backHigh); // -1..1
  const top = (frontTop - backTop) / h;                                       // ~-0.5..0.5
  return mass + 2 * top;
}

function groundAndNormalize(g: Gaussians) {
  const ys = new Float32Array(g.n);
  for (let i = 0; i < g.n; i++) ys[i] = g.pos[i * 3 + 1];
  const y0 = percentile(ys, 0.005), height = (percentile(ys, 0.995) - y0) || 1, k = 1 / height;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < g.n; i++) { zmin = Math.min(zmin, g.pos[i * 3 + 2]); zmax = Math.max(zmax, g.pos[i * 3 + 2]); }
  const zc = (zmin + zmax) / 2;
  for (let i = 0; i < g.n; i++) {
    g.pos[i * 3] *= k;
    g.pos[i * 3 + 1] = (g.pos[i * 3 + 1] - y0) * k;
    g.pos[i * 3 + 2] = (g.pos[i * 3 + 2] - zc) * k;
    for (let a = 0; a < 3; a++) g.scale[i * 3 + a] *= k;
  }
}

/** Keeps the most visible splats: drop the faintest/smallest first, so the budget costs as little detail as possible. */
function decimate(g: Gaussians, budget: number): Gaussians {
  if (g.n <= budget) return g;
  const score = new Float32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    const s = g.scale.subarray(i * 3, i * 3 + 3);
    score[i] = (g.rgba[i * 4 + 3] / 255) * (s[0] * s[1] + s[1] * s[2] + s[0] * s[2]);
  }
  const idx = Uint32Array.from({ length: g.n }, (_, i) => i).sort((a, b) => score[b] - score[a]);
  const out = subset(g, idx.subarray(0, budget));
  const grow = Math.sqrt(g.n / budget); // keep surface coverage after dropping splats
  for (let i = 0; i < out.scale.length; i++) out.scale[i] *= Math.min(grow, 1.6);
  return out;
}

export function cleanupSplatWithInfo(g: Gaussians, o: CleanupOptions): { g: Gaussians; info: CleanupInfo } {
  const min = o.minAlpha ?? 26;
  const keep: number[] = [];
  for (let i = 0; i < g.n; i++) if (g.rgba[i * 4 + 3] >= min) keep.push(i);
  const out = removeFloaters(subset(g, keep));
  if (o.source === 'trellis') rotate(out, [0, 1, 0, 0]); // 180 deg about X: up -Y -> +Y
  alignLongAxis(out, o.species);
  const score = headScore(out);
  const turned = (score < 0) !== Boolean(o.flipFacing);
  if (turned) rotate(out, yaw(Math.PI));
  groundAndNormalize(out);
  return { g: decimate(out, o.budget), info: { turned, headScore: score } };
}

export function cleanupSplat(g: Gaussians, o: CleanupOptions): Gaussians {
  return cleanupSplatWithInfo(g, o).g;
}

export const MAIN_BUDGET = 300_000, PEEK_BUDGET = 80_000;
