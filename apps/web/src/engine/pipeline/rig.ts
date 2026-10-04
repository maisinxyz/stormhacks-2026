// PRD 1.2 steps 6-7: fit a species skeleton to the cleaned splat, then compute skin weights.
// Input is cleanupSplat() output: y up (feet at 0, height 1), head toward +Z, left side at +X.
// Quadrupeds are fitted to the splat's own anatomy (legs, belly, head, tail found from splat density);
// anything that can't be found falls back to template proportions of the body box.
import type { Species } from '@fetch/contracts';
import type { Gaussians } from './gaussians';

type T = [number, number, number];
/** A bone driven by another bone's pose instead of clips (see skeleton.ts). */
export interface Follow {
  bone: string;
  /** Euler multipliers applied to the followed bone's rotation. */
  k: T;
  /** Use |angle| (knees flex the same way whichever way the leg swings). */
  abs?: boolean;
  /** Take this share of the followed bone's rotation away from it (neck + head split one head turn). */
  split?: boolean;
  /** Only react to this sign of the followed rotation (front knees flex on the forward swing only). */
  only?: 'neg' | 'pos';
}
export interface RigBone { name: string; parent: number; head: T; tail: T; follow?: Follow }
export interface Rig { template: string; bones: RigBone[] }

const pct = (a: ArrayLike<number>, p: number) => {
  const s = Float32Array.from(a).sort();
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))] : 0;
};
const lerp = (a: T, b: T, k: number): T => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mean = (pts: T[]): T => {
  const m: T = [0, 0, 0];
  for (const p of pts) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }
  return pts.length ? [m[0] / pts.length, m[1] / pts.length, m[2] / pts.length] : m;
};

/** Measured anatomy of a quadruped splat (also used to mask skin weights). */
export interface Anatomy {
  zBack: number; zFront: number; yBelly: number; yTop: number; ySpine: number;
  hipZ: number; shoulderZ: number;
  legs: Record<'FL' | 'FR' | 'BL' | 'BR', { top: T; knee: T; foot: T }>;
  neckBase: T; skull: T; nose: T;
  tailBase: T; tailMid: T; tailTip: T;
  fitted: { legs: boolean; head: boolean; tail: boolean };
}

/** Finds legs, belly line, head and tail from the splat cloud. */
export function measureQuadruped(g: Gaussians): Anatomy {
  const n = g.n, P = (i: number): T => [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]];
  const zs = new Float32Array(n), ys = new Float32Array(n), xs = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = g.pos[i * 3]; ys[i] = g.pos[i * 3 + 1]; zs[i] = g.pos[i * 3 + 2]; }
  const zBack = pct(zs, 0.01), zFront = pct(zs, 0.99), L = zFront - zBack || 1, yTop = pct(ys, 0.99);
  const halfW = Math.max(pct(xs.map(Math.abs), 0.95), 0.08);

  // Leg columns: 2-means on z of the ground slice (feet) gives the front and back leg pairs.
  const ground: number[] = [];
  for (let i = 0; i < n; i++) if (ys[i] < 0.12 * yTop) ground.push(zs[i]);
  let zf = zFront - 0.25 * L, zb = zBack + 0.25 * L;
  for (let it = 0; it < 12; it++) {
    let sf = 0, cf = 0, sb = 0, cb = 0;
    for (const z of ground) { if (Math.abs(z - zf) < Math.abs(z - zb)) { sf += z; cf++; } else { sb += z; cb++; } }
    if (cf) zf = sf / cf; if (cb) zb = sb / cb;
  }

  // Belly line: lowest height where the space between the front and back legs fills in.
  // (Front-to-back span can't be used: at ground level the four legs already span the whole body.)
  const gap0 = zb + 0.25 * (zf - zb), gap1 = zf - 0.25 * (zf - zb);
  const BINS = 50, inGap = new Float32Array(BINS), all = new Float32Array(BINS);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor((ys[i] / (yTop || 1)) * BINS));
    if (b < 0) continue;
    all[b]++;
    if (zs[i] > gap0 && zs[i] < gap1) inGap[b]++;
  }
  let yBelly = -1;
  for (let b = 1; b < BINS - 1; b++) if (all[b] > 20 && inGap[b] / all[b] > 0.08) { yBelly = (b / BINS) * yTop; break; }
  const legsOk = zf - zb > 0.2 * L && yBelly > 0.12 * yTop && yBelly < 0.75 * yTop;
  if (!legsOk) yBelly = 0.45 * yTop;
  const ySpine = yBelly + 0.55 * (yTop - yBelly);

  // Legs: points below the belly, assigned to the nearest column, then left/right by x.
  const legPts: T[] = [];
  for (let i = 0; i < n; i++) if (ys[i] < yBelly) legPts.push(P(i));
  const leg = (front: boolean, left: boolean, fallbackZ: number) => {
    const mine = legPts.filter(p => (Math.abs(p[2] - zf) < Math.abs(p[2] - zb)) === front && (p[0] >= 0) === left);
    const ok = legsOk && mine.length > Math.max(40, legPts.length * 0.04);
    const low = mine.filter(p => p[1] < 0.1 * yBelly);
    const lowest = low.length >= 10 ? low : mine.slice().sort((p, q) => p[1] - q[1]).slice(0, Math.max(10, Math.floor(mine.length / 10)));
    const foot: T = ok ? mean(lowest) : [left ? halfW * 0.55 : -halfW * 0.55, 0.02, fallbackZ];
    const colX = ok ? pct(mine.map(p => p[0]), 0.5) : foot[0], colZ = ok ? pct(mine.map(p => p[2]), 0.5) : foot[2];
    const top: T = [colX * 0.85, yBelly + 0.18 * (yTop - yBelly), colZ];
    const footPt: T = [foot[0], Math.max(0.02, Math.min(foot[1], 0.06)), foot[2]];
    return { top, knee: lerp(top, footPt, 0.5), foot: footPt, ok };
  };
  const FL = leg(true, true, zFront - 0.22 * L), FR = leg(true, false, zFront - 0.22 * L);
  const BL = leg(false, true, zBack + 0.22 * L), BR = leg(false, false, zBack + 0.22 * L);
  // A leg that wasn't found mirrors its partner across x.
  const mirror = (a: typeof FL, b: typeof FL) => {
    if (a.ok || !b.ok) return a;
    const m = (p: T): T => [-p[0], p[1], p[2]];
    return { top: m(b.top), knee: m(b.knee), foot: m(b.foot), ok: false };
  };
  const legs = { FL: mirror(FL, FR), FR: mirror(FR, FL), BL: mirror(BL, BR), BR: mirror(BR, BL) };
  const shoulderZ = (legs.FL.top[2] + legs.FR.top[2]) / 2, hipZ = (legs.BL.top[2] + legs.BR.top[2]) / 2;

  // Head: the mass in front of the shoulders and above the belly.
  const front: T[] = [];
  for (let i = 0; i < n; i++) if (zs[i] > shoulderZ + 0.08 * L && ys[i] > yBelly) front.push(P(i));
  const headOk = front.length > n * 0.01;
  const neckBase: T = [0, ySpine + 0.25 * (yTop - ySpine), shoulderZ + 0.04 * L];
  let nose: T, skull: T;
  if (headOk) {
    const tipZ = pct(front.map(p => p[2]), 0.985);
    const tip = front.filter(p => p[2] > tipZ - 0.03 * L);
    nose = [0, mean(tip)[1], tipZ];
    const headBlob = front.filter(p => p[2] > zFront - 0.3 * L);
    const c = mean(headBlob.length > 30 ? headBlob : front);
    skull = [0, c[1], Math.min(c[2], nose[2] - 0.08 * L)];
  } else {
    skull = [0, yTop * 0.85, zFront - 0.15 * L];
    nose = [0, yTop * 0.8, zFront];
  }

  // Tail: whatever sticks out behind the rump line (the body's rear surface at spine height).
  // Measured on the thighs, below where a raised tail leaves the body, so the tail itself can't move the line.
  const yThigh0 = yBelly + 0.25 * (ySpine - yBelly), yThigh1 = ySpine - 0.05 * yTop;
  const thighBand: number[] = [];
  for (let i = 0; i < n; i++) if (ys[i] > yThigh0 && ys[i] < yThigh1 && zs[i] < hipZ) thighBand.push(zs[i]);
  const rumpZ = thighBand.length > 50 ? pct(thighBand, 0.05) : hipZ - 0.1 * L;
  const rear: T[] = [];
  for (let i = 0; i < n; i++) if (zs[i] < rumpZ - 0.02 * L && ys[i] > yThigh0) rear.push(P(i));
  const tailBase: T = [0, ySpine + 0.2 * (yTop - ySpine), rumpZ];
  const tailOk = rear.length > n * 0.004;
  let tailTip: T;
  if (tailOk) {
    const d = rear.map(p => Math.hypot(p[1] - tailBase[1], p[2] - tailBase[2]));
    const far = pct(d, 0.9);
    tailTip = mean(rear.filter((_, k) => d[k] >= far));
    tailTip[0] = 0;
  } else tailTip = [0, tailBase[1] + 0.1, zBack];
  const tailMid = lerp(tailBase, tailTip, 0.5);

  return {
    zBack, zFront, yBelly, yTop, ySpine, hipZ, shoulderZ,
    legs: { FL: legs.FL, FR: legs.FR, BL: legs.BL, BR: legs.BR },
    neckBase, skull, nose, tailBase, tailMid, tailTip,
    fitted: { legs: legsOk && FL.ok && BL.ok, head: headOk, tail: tailOk },
  };
}

/** Knee/hock flex as the upper leg swings (multipliers on the upper leg's x rotation). */
// Positive x rotation on a downward bone swings its foot back and up: front knees flex that way, hocks the other.
const FRONT_KNEE: Follow = { bone: '', k: [0.6, 0, 0], abs: true, only: 'neg' };
const HIND_KNEE: Follow = { bone: '', k: [-0.8, 0, 0], abs: true };

function quadrupedRig(g: Gaussians): Rig {
  const a = measureQuadruped(g);
  // Body pivot where the original template had it (15% of the half-length behind center): every clip's root
  // pitch and y offset was tuned around that point, e.g. sit keeps the front paws planted.
  const rootHead: T = [0, a.ySpine, (a.zFront + a.zBack) / 2 - 0.15 * (a.zFront - a.zBack) / 2];
  const rootTail: T = [0, a.ySpine, a.shoulderZ];
  const bones: RigBone[] = [
    { name: 'root', parent: -1, head: rootHead, tail: rootTail },
    { name: 'neck', parent: 0, head: a.neckBase, tail: a.skull, follow: { bone: 'head', k: [0.45, 0.45, 0.45], split: true } },
    { name: 'head', parent: 1, head: a.skull, tail: a.nose },
    { name: 'tail', parent: 0, head: a.tailBase, tail: a.tailMid },
    { name: 'tail2', parent: 3, head: a.tailMid, tail: a.tailTip, follow: { bone: 'tail', k: [0.8, 0.8, 0.8] } },
  ];
  for (const [id, knee] of [['FL', FRONT_KNEE], ['FR', FRONT_KNEE], ['BL', HIND_KNEE], ['BR', HIND_KNEE]] as const) {
    const l = a.legs[id], upper = bones.length;
    bones.push({ name: `leg${id}`, parent: 0, head: l.top, tail: l.knee });
    bones.push({ name: `leg${id}2`, parent: upper, head: l.knee, tail: l.foot, follow: { ...knee, bone: `leg${id}` } });
  }
  return { template: 'quadruped2', bones };
}

// Bird: template proportions of the oriented body box (+Z = beak).
const BIRD: [string, number, T, T][] = [
  ['root', -1, [0, 0.5, -0.1], [0, 0.6, 0.2]],
  ['head', 0, [0, 0.75, 0.2], [0, 0.95, 0.6]],
  ['tail', 0, [0, 0.45, -0.4], [0, 0.2, -1]],
  ['wingL', 0, [0.3, 0.6, 0], [1, 0.6, 0]],
  ['wingR', 0, [-0.3, 0.6, 0], [-1, 0.6, 0]],
  ['legL', 0, [0.2, 0.25, 0], [0.2, 0, 0]],
  ['legR', 0, [-0.2, 0.25, 0], [-0.2, 0, 0]],
];
function birdRig(g: Gaussians): Rig {
  const xs: number[] = [], zs: number[] = [];
  let h = 0;
  for (let i = 0; i < g.n; i++) { xs.push(Math.abs(g.pos[i * 3])); zs.push(Math.abs(g.pos[i * 3 + 2])); h = Math.max(h, g.pos[i * 3 + 1]); }
  const hl = pct(zs, 0.98), hw = Math.max(pct(xs, 0.98), 0.25 * hl);
  const f = (v: T): T => [v[0] * hw, v[1] * h, v[2] * hl];
  return { template: 'biped_wings', bones: BIRD.map(([name, parent, head, tail]) => ({ name, parent, head: f(head), tail: f(tail) })) };
}

export function fitRig(g: Gaussians, species: Species): Rig {
  return species === 'bird' ? birdRig(g) : quadrupedRig(g); // cat/rodent use the quadruped fit
}

function distSeg(px: number, py: number, pz: number, a: T, b: T) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(px - a[0] - abx * t, py - a[1] - aby * t, pz - a[2] - abz * t);
}

/**
 * Which bones may influence a splat. Keeps left legs from pulling right-leg or belly splats, the head
 * from pulling the chest, and the tail from pulling the rump: the cause of tearing on moving limbs.
 */
function eligibility(rig: Rig, g: Gaussians): (i: number, b: number) => boolean {
  const names = rig.bones.map(b => b.name);
  if (rig.template !== 'quadruped2') return () => true;
  const a = measureQuadruped(g), L = a.zFront - a.zBack;
  return (i, b) => {
    const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2], n = names[b];
    if (n.startsWith('leg')) {
      const id = n.slice(3, 5) as 'FL' | 'FR' | 'BL' | 'BR', l = a.legs[id];
      const side = id[1] === 'L' ? 1 : -1, frontLeg = id[0] === 'F';
      if (y > a.yBelly + 0.15 * (a.yTop - a.yBelly)) return false;
      if (x * side < -0.012) return false;
      const midZ = (a.shoulderZ + a.hipZ) / 2;
      if (frontLeg ? z < midZ : z > midZ) return false;
      // Stay within the leg's own column (blended toward the body above the belly).
      const t = Math.max(0, Math.min(1, (l.top[1] - y) / (l.top[1] - l.foot[1] || 1)));
      const cz = l.top[2] + (l.foot[2] - l.top[2]) * t;
      return Math.abs(z - cz) < 0.16 * L;
    }
    if (n === 'neck' || n === 'head') return z > a.shoulderZ - 0.02 * L && y > a.yBelly * 0.8;
    if (n === 'tail' || n === 'tail2') return z < a.hipZ - 0.04 * L;
    return true;
  };
}

/** weights.bin: per splat 4x uint8 bone idx then 4x uint8 weight (sum 255). */
export function skinWeights(g: Gaussians, rig: Rig, smooth = true): Uint8Array {
  const nb = rig.bones.length, n = g.n, w = new Float32Array(n * nb);
  const ok = eligibility(rig, g);
  for (let i = 0; i < n; i++) {
    const px = g.pos[i * 3], py = g.pos[i * 3 + 1], pz = g.pos[i * 3 + 2];
    const d = rig.bones.map((b, id) => ({ id, d: ok(i, id) ? distSeg(px, py, pz, b.head, b.tail) : Infinity }))
      .sort((a, b) => a.d - b.d).slice(0, 4).filter(x => Number.isFinite(x.d));
    let sum = 0;
    const inv = d.map(x => { const v = 1 / (x.d + 0.015) ** 3; sum += v; return v; });
    d.forEach((x, k) => { w[i * nb + x.id] = inv[k] / sum; });
    if (!d.length) w[i * nb] = 1; // root
  }
  let cur = w;
  if (smooth) {
    // Blur weights over a spatial hash (stands in for k-NN graph smoothing), then re-apply eligibility so
    // smoothing never reintroduces cross-limb weights.
    const cell = 0.03, ck = (x: number, y: number, z: number) => `${x},${y},${z}`;
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
      let s = 0;
      for (let k = 0; k < nb; k++) {
        const v = ok(i, k) ? 0.5 * w[i * nb + k] + 0.5 * acc[k] / cnt : 0;
        cur[i * nb + k] = v; s += v;
      }
      if (s > 0) for (let k = 0; k < nb; k++) cur[i * nb + k] /= s; else cur[i * nb] = 1;
    }
  }
  const out = new Uint8Array(n * 8), top: { id: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    top.length = 0;
    for (let k = 0; k < nb; k++) if (cur[i * nb + k] > 0) top.push({ id: k, v: cur[i * nb + k] });
    top.sort((a, b) => b.v - a.v).length = Math.min(4, top.length);
    if (!top.length) top.push({ id: 0, v: 1 });
    // Largest-remainder rounding: integer weights that always sum to exactly 255 (per-weight rounding can overshoot).
    const s = top.reduce((x, y) => x + y.v, 0);
    const exact = top.map(t => (t.v / s) * 255), ints = exact.map(Math.floor);
    let left = 255 - ints.reduce((x, y) => x + y, 0);
    for (const k of exact.map((e, k) => k).sort((a, b) => (exact[b] - ints[b]) - (exact[a] - ints[a]))) if (left-- > 0) ints[k]++;
    for (let k = 0; k < 4; k++) {
      out[i * 8 + k] = top[k]?.id ?? 0;
      out[i * 8 + 4 + k] = ints[k] ?? 0;
    }
  }
  return out;
}
