// Procedural placeholder pets (blobby Gaussians) so skinning is testable without image-to-3D output.
// Swap real bundles into public/bundles/<species>/ later. Format: see @fetch/contracts PetBundle.
import { mkdirSync, writeFileSync } from 'node:fs';

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

// bone = {name,parent,head,tail}; blob = {c:[x,y,z], r:[rx,ry,rz], color:[r,g,b], n}. Feet on y=0, face +Z.
const SPECIES = {
  dog: {
    template: 'quadruped',
    bones: [
      { name: 'root', parent: -1, head: [0, 0.55, -0.1], tail: [0, 0.55, 0.3] },
      { name: 'head', parent: 0, head: [0, 0.7, 0.35], tail: [0, 0.8, 0.6] },
      { name: 'tail', parent: 0, head: [0, 0.65, -0.45], tail: [0, 0.9, -0.75] },
      { name: 'legFL', parent: 0, head: [0.15, 0.5, 0.25], tail: [0.15, 0, 0.25] },
      { name: 'legFR', parent: 0, head: [-0.15, 0.5, 0.25], tail: [-0.15, 0, 0.25] },
      { name: 'legBL', parent: 0, head: [0.15, 0.5, -0.3], tail: [0.15, 0, -0.3] },
      { name: 'legBR', parent: 0, head: [-0.15, 0.5, -0.3], tail: [-0.15, 0, -0.3] },
    ],
    blobs: [
      { c: [0, 0.6, -0.05], r: [0.2, 0.18, 0.4], color: [0.75, 0.5, 0.25], n: 5000 },
      { c: [0, 0.78, 0.45], r: [0.14, 0.14, 0.16], color: [0.8, 0.55, 0.3], n: 2000 },
      { c: [0, 0.74, 0.62], r: [0.06, 0.05, 0.08], color: [0.2, 0.12, 0.08], n: 400 },
      { c: [0, 0.78, -0.6], r: [0.04, 0.12, 0.06], color: [0.7, 0.45, 0.2], n: 600 },
      ...[[0.15, 0.25], [-0.15, 0.25], [0.15, -0.3], [-0.15, -0.3]].map(([x, z]) => ({ c: [x, 0.25, z], r: [0.05, 0.25, 0.05], color: [0.65, 0.42, 0.2], n: 700 })),
    ],
  },
  bird: {
    template: 'biped_wings',
    bones: [
      { name: 'root', parent: -1, head: [0, 0.45, 0], tail: [0, 0.55, 0.1] },
      { name: 'head', parent: 0, head: [0, 0.7, 0.1], tail: [0, 0.85, 0.2] },
      { name: 'tail', parent: 0, head: [0, 0.4, -0.15], tail: [0, 0.2, -0.45] },
      { name: 'wingL', parent: 0, head: [0.15, 0.55, 0], tail: [0.55, 0.55, 0] },
      { name: 'wingR', parent: 0, head: [-0.15, 0.55, 0], tail: [-0.55, 0.55, 0] },
      { name: 'legL', parent: 0, head: [0.06, 0.25, 0], tail: [0.06, 0, 0] },
      { name: 'legR', parent: 0, head: [-0.06, 0.25, 0], tail: [-0.06, 0, 0] },
    ],
    blobs: [
      { c: [0, 0.5, 0], r: [0.16, 0.2, 0.15], color: [0.15, 0.7, 0.3], n: 5000 },
      { c: [0, 0.78, 0.12], r: [0.1, 0.1, 0.1], color: [0.9, 0.2, 0.2], n: 1800 },
      { c: [0, 0.74, 0.25], r: [0.03, 0.03, 0.05], color: [1, 0.8, 0.2], n: 200 },
      { c: [0, 0.3, -0.3], r: [0.04, 0.03, 0.18], color: [0.2, 0.4, 0.9], n: 600 },
      { c: [0.35, 0.55, 0], r: [0.2, 0.02, 0.1], color: [0.1, 0.55, 0.9], n: 1200 },
      { c: [-0.35, 0.55, 0], r: [0.2, 0.02, 0.1], color: [0.1, 0.55, 0.9], n: 1200 },
      { c: [0.06, 0.12, 0], r: [0.015, 0.12, 0.015], color: [0.9, 0.7, 0.3], n: 150 },
      { c: [-0.06, 0.12, 0], r: [0.015, 0.12, 0.015], color: [0.9, 0.7, 0.3], n: 150 },
    ],
  },
};

const distSeg = (p, a, b) => {
  const ab = b.map((v, i) => v - a[i]), ap = p.map((v, i) => v - a[i]);
  const t = Math.max(0, Math.min(1, ap.reduce((s, v, i) => s + v * ab[i], 0) / (ab.reduce((s, v) => s + v * v, 0) || 1)));
  return Math.hypot(...p.map((v, i) => v - (a[i] + ab[i] * t)));
};

for (const [name, sp] of Object.entries(SPECIES)) {
  const total = sp.blobs.reduce((s, b) => s + b.n, 0);
  const splat = Buffer.alloc(total * 32), weights = Buffer.alloc(total * 8);
  let i = 0;
  for (const b of sp.blobs) for (let k = 0; k < b.n; k++, i++) {
    const p = b.c.map((c, a) => c + gauss() * b.r[a] * 0.5);
    const o = i * 32;
    p.forEach((v, a) => splat.writeFloatLE(v, o + a * 4));
    const s = Math.max(0.012, Math.min(...b.r) * 0.35);
    [s, s, s].forEach((v, a) => splat.writeFloatLE(v, o + 12 + a * 4));
    b.color.forEach((v, a) => splat.writeUInt8(Math.max(0, Math.min(255, Math.round((v + gauss() * 0.04) * 255))), o + 24 + a));
    splat.writeUInt8(230, o + 27);
    [255, 128, 128, 128].forEach((v, a) => splat.writeUInt8(v, o + 28 + a)); // identity quat (w,x,y,z)
    // skin weights: nearest 4 bones to bone segments, inverse distance
    const near = sp.bones.map((bn, id) => ({ id, d: distSeg(p, bn.head, bn.tail) })).sort((x, y) => x.d - y.d).slice(0, 4);
    const inv = near.map(n => 1 / (n.d + 0.02) ** 2), sum = inv.reduce((x, y) => x + y, 0);
    let acc = 0;
    near.forEach((n, a) => {
      const w = a === 3 ? 255 - acc : Math.round((inv[a] / sum) * 255);
      acc += w;
      weights.writeUInt8(n.id, i * 8 + a);
      weights.writeUInt8(Math.max(0, w), i * 8 + 4 + a);
    });
  }
  const dir = new URL(`../public/bundles/${name}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('pet.splat', dir), splat);
  writeFileSync(new URL('weights.bin', dir), weights);
  writeFileSync(new URL('rig.json', dir), JSON.stringify({ template: sp.template, bones: sp.bones }, null, 1));
  writeFileSync(new URL('bundle.json', dir), JSON.stringify({
    id: `demo-${name}`, name, species: name,
    splatUrl: `/bundles/${name}/pet.splat`, rigUrl: `/bundles/${name}/rig.json`,
    weightsUrl: `/bundles/${name}/weights.bin`, thumbnailUrl: '',
    personality: { eager: 0.5, sassy: 0.5, anxious: 0.5, chatty: 0.5 },
    stats: { energy: 100, happiness: 80, hunger: 0 }, createdAt: new Date().toISOString(),
  }, null, 1));
  console.log(name, total, 'splats');
}
