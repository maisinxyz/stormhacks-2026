// PRD 1.2 steps 6-7: fit a species template skeleton to the cleaned splat, then compute skin weights.
import type { Species } from '@fetch/contracts';
import type { Gaussians } from './gaussians';

export interface RigBone { name: string; parent: number; head: [number, number, number]; tail: [number, number, number] }
export interface Rig { template: string; bones: RigBone[] }

// Template coords are fractions of the fitted body box: x * halfWidth, y * height, z * halfLength (+Z = front).
type T = [number, number, number];
const B = (name: string, parent: number, head: T, tail: T) => ({ name, parent, head, tail });
const TEMPLATES: Record<'quadruped' | 'biped_wings', { name: string; bones: ReturnType<typeof B>[] }> = {
  quadruped: {
    name: 'quadruped',
    bones: [
      B('root', -1, [0, 0.6, -0.15], [0, 0.6, 0.45]),
      B('head', 0, [0, 0.75, 0.55], [0, 0.85, 1]),
      B('tail', 0, [0, 0.7, -0.7], [0, 0.95, -1]),
      B('legFL', 0, [0.6, 0.55, 0.4], [0.6, 0, 0.4]),
      B('legFR', 0, [-0.6, 0.55, 0.4], [-0.6, 0, 0.4]),
      B('legBL', 0, [0.6, 0.55, -0.45], [0.6, 0, -0.45]),
      B('legBR', 0, [-0.6, 0.55, -0.45], [-0.6, 0, -0.45]),
    ],
  },
  biped_wings: {
    name: 'biped_wings',
    bones: [
      B('root', -1, [0, 0.5, -0.1], [0, 0.6, 0.2]),
      B('head', 0, [0, 0.75, 0.2], [0, 0.95, 0.6]),
      B('tail', 0, [0, 0.45, -0.4], [0, 0.2, -1]),
      B('wingL', 0, [0.3, 0.6, 0], [1, 0.6, 0]),
      B('wingR', 0, [-0.3, 0.6, 0], [-1, 0.6, 0]),
      B('legL', 0, [0.2, 0.25, 0], [0.2, 0, 0]),
      B('legR', 0, [-0.2, 0.25, 0], [-0.2, 0, 0]),
    ],
  },
};

const pct = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

// ponytail: fit = scale template to the 2-98% bounding box (cleanup already aligned PCA axes to x/z); no density-landmark refinement yet.
export function fitRig(g: Gaussians, species: Species): Rig {
  const tpl = species === 'bird' ? TEMPLATES.biped_wings : TEMPLATES.quadruped; // cat/rodent reuse quadruped until their packs exist
  const xs: number[] = [], zs: number[] = [];
  let h = 0;
  for (let i = 0; i < g.n; i++) { xs.push(Math.abs(g.pos[i * 3])); zs.push(Math.abs(g.pos[i * 3 + 2])); h = Math.max(h, g.pos[i * 3 + 1]); }
  const hw = pct(xs, 0.98), hl = pct(zs, 0.98);
  const f = (v: T): T => [v[0] * hw, v[1] * h, v[2] * hl];
  return { template: tpl.name, bones: tpl.bones.map(b => ({ name: b.name, parent: b.parent, head: f(b.head), tail: f(b.tail) })) };
}

function distSeg(px: number, py: number, pz: number, a: T, b: T) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(px - a[0] - abx * t, py - a[1] - aby * t, pz - a[2] - abz * t);
}

/** weights.bin: per splat 4x uint8 bone idx then 4x uint8 weight (sum 255). */
export function skinWeights(g: Gaussians, rig: Rig, smooth = true): Uint8Array {
  const nb = rig.bones.length, n = g.n, w = new Float32Array(n * nb);
  for (let i = 0; i < n; i++) {
    const px = g.pos[i * 3], py = g.pos[i * 3 + 1], pz = g.pos[i * 3 + 2];
    const d = rig.bones.map((b, id) => ({ id, d: distSeg(px, py, pz, b.head, b.tail) })).sort((a, b) => a.d - b.d).slice(0, 4);
    let sum = 0;
    const inv = d.map(x => { const v = 1 / (x.d + 0.02) ** 2; sum += v; return v; });
    d.forEach((x, k) => { w[i * nb + x.id] = inv[k] / sum; });
  }
  let cur = w;
  if (smooth) {
    // Box-blur weights over a spatial hash (stands in for the k-NN graph smoothing): own weight 50%, 27-cell neighbourhood mean 50%.
    const cell = 0.04, ck = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const cells = new Map<string, { sum: Float32Array; n: number }>();
    const cellOf = (i: number) => [0, 1, 2].map(k => Math.floor(g.pos[i * 3 + k] / cell));
    for (let i = 0; i < n; i++) {
      const [a, b, c] = cellOf(i), key = ck(a, b, c);
      let e = cells.get(key);
      if (!e) cells.set(key, e = { sum: new Float32Array(nb), n: 0 });
      for (let k = 0; k < nb; k++) e.sum[k] += w[i * nb + k];
      e.n++;
    }
    cur = new Float32Array(n * nb);
    const acc = new Float32Array(nb);
    for (let i = 0; i < n; i++) {
      const [a, b, c] = cellOf(i);
      acc.fill(0);
      let cnt = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const e = cells.get(ck(a + dx, b + dy, c + dz));
        if (e) { for (let k = 0; k < nb; k++) acc[k] += e.sum[k]; cnt += e.n; }
      }
      for (let k = 0; k < nb; k++) cur[i * nb + k] = 0.5 * w[i * nb + k] + 0.5 * acc[k] / cnt;
    }
  }
  const out = new Uint8Array(n * 8), top: { id: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    top.length = 0;
    for (let k = 0; k < nb; k++) if (cur[i * nb + k] > 0) top.push({ id: k, v: cur[i * nb + k] });
    top.sort((a, b) => b.v - a.v).length = Math.min(4, top.length);
    const s = top.reduce((x, y) => x + y.v, 0) || 1;
    let acc = 0;
    for (let k = 0; k < 4; k++) {
      const t = top[k];
      const wt = !t ? 0 : k === top.length - 1 ? 255 - acc : Math.round((t.v / s) * 255);
      acc += wt;
      out[i * 8 + k] = t ? t.id : 0;
      out[i * 8 + 4 + k] = wt;
    }
  }
  return out;
}
