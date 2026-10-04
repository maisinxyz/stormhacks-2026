// Bake a TRELLIS 3DGS .ply into an engine bundle (pet.splat, rig.json, weights.bin, bundle.json), and
// optionally render posed previews to check the rig without a browser.
//   pnpm --filter @fetch/web bake <in.ply> <outDir> [--species dog] [--name Pip] [--flip] [--budget 200000] [--preview stand,walk,sit]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import type { PetBundle, Species } from '@fetch/contracts';
import { cleanupSplatWithInfo } from '../src/engine/pipeline/cleanup';
import { encodeSplat, parsePly, type Gaussians } from '../src/engine/pipeline/gaussians';
import { fitRig, measureQuadruped, skinWeights } from '../src/engine/pipeline/rig';
import { Skeleton } from '../src/engine/skeleton';
import { PACKS } from '../src/engine/species';

const args = process.argv.slice(2);
const opt = (k: string, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [input, outDir] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input || !outDir) { console.error('usage: bake-ply <in.ply> <outDir> [--species dog] [--name Pip] [--flip] [--budget N] [--preview clips]'); process.exit(1); }
const species = opt('species', 'dog') as Species, name = opt('name', 'Pip'), budget = Number(opt('budget', '200000'));
const id = outDir.replace(/\\/g, '/').split('/').filter(Boolean).pop()!;

const t0 = Date.now();
const raw = parsePly(new Uint8Array(readFileSync(input)).buffer);
const { g, info } = cleanupSplatWithInfo(raw, { species, budget, source: 'trellis', flipFacing: args.includes('--flip') });
const rig = fitRig(g, species);
const weights = skinWeights(g, rig);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'pet.splat'), Buffer.from(encodeSplat(g)));
writeFileSync(join(outDir, 'rig.json'), JSON.stringify(rig, null, 1));
writeFileSync(join(outDir, 'weights.bin'), weights);
const base = `/bundles/${id}`;
const bundle: PetBundle = {
  id: `demo-${id}`, name, species, splatUrl: `${base}/pet.splat`, rigUrl: `${base}/rig.json`, weightsUrl: `${base}/weights.bin`,
  thumbnailUrl: '', personality: PACKS[species].personality, stats: { energy: 100, happiness: 80, hunger: 0 }, createdAt: new Date().toISOString(),
};
writeFileSync(join(outDir, 'bundle.json'), JSON.stringify(bundle, null, 1));
console.log(`baked ${raw.n} -> ${g.n} splats in ${Date.now() - t0} ms; turned=${info.turned} headScore=${info.headScore.toFixed(2)}`);
if (species !== 'bird') {
  const a = measureQuadruped(g);
  console.log('fitted', JSON.stringify(a.fitted), 'belly', a.yBelly.toFixed(2), 'hipZ', a.hipZ.toFixed(2), 'shoulderZ', a.shoulderZ.toFixed(2));
}

const preview = opt('preview');
if (preview) for (const clipName of preview.split(',')) renderPose(g, rig, weights, clipName);

/** CPU-skins splat centers with the real skeleton + clip and writes a side and a 3/4 view PNG. */
function renderPose(g: Gaussians, rig: ReturnType<typeof fitRig>, w: Uint8Array, clipName: string) {
  const clip = PACKS[species].clips[clipName];
  if (!clip) { console.warn('no clip', clipName); return; }
  const sk = new Skeleton(rig.bones);
  const pose = clip.fn(clip.loop ? 0.25 : 1, clip.loop ? clip.dur * 0.25 : clip.dur);
  for (const b of rig.bones) sk.setEuler(b.name, 0, 0, 0);
  for (const [n, e] of Object.entries(pose.bones)) sk.setEuler(n, e[0], e[1], e[2]);
  sk.update();
  const out = new Float32Array(g.n * 3), v = new THREE.Vector3(), acc = new THREE.Vector3();
  for (let i = 0; i < g.n; i++) {
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const wt = w[i * 8 + 4 + k] / 255;
      if (!wt) continue;
      v.set(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]).applyMatrix4(sk.world[w[i * 8 + k]]);
      acc.addScaledVector(v, wt);
    }
    out.set([acc.x, acc.y + (pose.y ?? 0), acc.z], i * 3);
  }
  for (const [view, yawDeg] of [['side', 90], ['quarter', 35]] as const) png(out, g, yawDeg, join(outDir, `preview-${clipName}-${view}.png`));
}

function png(pos: Float32Array, g: Gaussians, yawDeg: number, file: string) {
  const W = 420, H = 320, img = new Uint8Array(W * H * 3).fill(238), depth = new Float32Array(W * H).fill(-Infinity);
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180), sc = 170;
  for (let i = 0; i < g.n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const u = x * c - z * s, d = x * s + z * c; // camera on +X side looking at the pet's left flank when yaw=90
    const px = Math.round(W / 2 + u * sc), py = Math.round(H - 20 - y * sc);
    for (let du = 0; du < 2; du++) for (let dv = 0; dv < 2; dv++) {
      const X = px + du, Y = py + dv;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const k = Y * W + X;
      if (d < depth[k]) continue;
      depth[k] = d;
      img[k * 3] = g.rgba[i * 4]; img[k * 3 + 1] = g.rgba[i * 4 + 1]; img[k * 3 + 2] = g.rgba[i * 4 + 2];
    }
  }
  for (let X = 0; X < W; X++) { const k = (H - 20) * W + X; img[k * 3] = 120; img[k * 3 + 1] = 120; img[k * 3 + 2] = 120; } // ground line
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c2 = n; for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 0xedb88320 ^ (c2 >>> 1) : c2 >>> 1; return c2 >>> 0; });
  const crc = (b: Buffer) => { let r = ~0; for (const x of b) r = crcTable[(r ^ x) & 255] ^ (r >>> 8); return (~r) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
