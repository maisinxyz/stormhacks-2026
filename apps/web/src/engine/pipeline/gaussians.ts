// In-memory splat cloud used by the generation pipeline (PRD 1.2 steps 5-8) and the .splat codec.
export interface Gaussians {
  n: number;
  pos: Float32Array;   // 3n
  scale: Float32Array; // 3n, linear (not log)
  rgba: Uint8Array;    // 4n
  rot: Float32Array;   // 4n, unit quaternion (w,x,y,z)
}

export function subset(g: Gaussians, keep: ArrayLike<number>): Gaussians {
  const n = keep.length;
  const o: Gaussians = { n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3), rgba: new Uint8Array(n * 4), rot: new Float32Array(n * 4) };
  for (let i = 0; i < n; i++) {
    const s = keep[i];
    for (let k = 0; k < 3; k++) { o.pos[i * 3 + k] = g.pos[s * 3 + k]; o.scale[i * 3 + k] = g.scale[s * 3 + k]; }
    for (let k = 0; k < 4; k++) { o.rgba[i * 4 + k] = g.rgba[s * 4 + k]; o.rot[i * 4 + k] = g.rot[s * 4 + k]; }
  }
  return o;
}

/** .splat: 32 B/splat (pos 3f, scale 3f, rgba 4u8, rot 4u8 as (q*128+128)). */
export function encodeSplat(g: Gaussians): ArrayBuffer {
  const buf = new ArrayBuffer(g.n * 32), f = new Float32Array(buf), u = new Uint8Array(buf);
  for (let i = 0; i < g.n; i++) {
    for (let k = 0; k < 3; k++) { f[i * 8 + k] = g.pos[i * 3 + k]; f[i * 8 + 3 + k] = g.scale[i * 3 + k]; }
    for (let k = 0; k < 4; k++) {
      u[i * 32 + 24 + k] = g.rgba[i * 4 + k];
      u[i * 32 + 28 + k] = Math.max(0, Math.min(255, Math.round(g.rot[i * 4 + k] * 128 + 128)));
    }
  }
  return buf;
}

export function decodeSplat(buf: ArrayBuffer): Gaussians {
  const n = buf.byteLength / 32, f = new Float32Array(buf), u = new Uint8Array(buf);
  const g: Gaussians = { n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3), rgba: new Uint8Array(n * 4), rot: new Float32Array(n * 4) };
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { g.pos[i * 3 + k] = f[i * 8 + k]; g.scale[i * 3 + k] = f[i * 8 + 3 + k]; }
    let l = 0;
    for (let k = 0; k < 4; k++) { g.rgba[i * 4 + k] = u[i * 32 + 24 + k]; const q = (u[i * 32 + 28 + k] - 128) / 128; g.rot[i * 4 + k] = q; l += q * q; }
    l = Math.sqrt(l) || 1;
    for (let k = 0; k < 4; k++) g.rot[i * 4 + k] /= l;
  }
  return g;
}

/** Binary little-endian 3DGS .ply (float properties) -> Gaussians. */
export function parsePly(buf: ArrayBuffer): Gaussians {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)));
  const end = head.indexOf('end_header');
  if (end < 0 || !head.includes('binary_little_endian')) throw new Error('unsupported ply');
  const dataStart = head.indexOf('\n', end) + 1;
  const n = +/element vertex (\d+)/.exec(head)![1];
  const props = [...head.slice(0, end).matchAll(/property float (\w+)/g)].map(m => m[1]);
  const stride = props.length, idx = (k: string) => props.indexOf(k);
  const f = new Float32Array(buf.slice(dataStart, dataStart + n * stride * 4));
  const need = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];
  if (need.some(k => idx(k) < 0)) throw new Error('ply missing gaussian properties');
  const [x, y, z, s0, s1, s2, r0, r1, r2, r3, c0, c1, c2, op] = need.map(idx);
  const g: Gaussians = { n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3), rgba: new Uint8Array(n * 4), rot: new Float32Array(n * 4) };
  const SH = 0.28209479, cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0, o = 0; i < n; i++, o += stride) {
    g.pos.set([f[o + x], f[o + y], f[o + z]], i * 3);
    g.scale.set([Math.exp(f[o + s0]), Math.exp(f[o + s1]), Math.exp(f[o + s2])], i * 3);
    const q = [f[o + r0], f[o + r1], f[o + r2], f[o + r3]], l = Math.hypot(...q) || 1;
    g.rot.set(q.map(v => v / l), i * 4);
    g.rgba.set([cl(0.5 + SH * f[o + c0]), cl(0.5 + SH * f[o + c1]), cl(0.5 + SH * f[o + c2]), cl(1 / (1 + Math.exp(-f[o + op])))], i * 4);
  }
  return g;
}
