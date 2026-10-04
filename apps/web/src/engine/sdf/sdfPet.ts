// Plush pet drawn with signed distance fields instead of splats (play.md B: art direction "soft plush").
// The body is a handful of ellipsoids joined with a smooth union; each one rides a rig bone, so every existing clip
// (walk, sit, wag, head look) animates it. A box around the pet is rasterised and each pixel raymarches the field.
// Same surface as SplatMesh (mesh, uniforms.uBones/uTint, setBudget, setDepthTest, footprint, update), so the Engine
// treats the two the same.
import * as THREE from 'three';
import type { Bone } from '../skeleton';
import { MAX_BONES } from '../splatRenderer';

/** Continuous description of a plush dog. Everything is a ratio; the result is normalised to height 1, feet at y=0. */
export interface PlushTraits {
  bodyLength: number;  // torso length, 0.6 (stubby) .. 1.2 (long)
  girth: number;       // torso radius, 0.2 .. 0.32
  legLength: number;   // 0.16 .. 0.42
  headSize: number;    // head radius, 0.2 .. 0.3 (plush: big)
  snout: number;       // muzzle length, 0.05 (flat face) .. 0.26 (long)
  earShape: number;    // 0 = floppy, hanging .. 1 = pointy, upright
  earSize: number;     // 0.6 .. 1.5
  tailLength: number;  // 0.08 (stub) .. 0.5
  tailUp: number;      // 0 = hangs back .. 1 = carried up
  colors: { base: string; belly: string; ear: string; muzzle: string; paws: string; tailTip: string; nose: string; eye: string };
}

export const DEFAULT_PLUSH: PlushTraits = {
  bodyLength: 0.82, girth: 0.25, legLength: 0.24, headSize: 0.27, snout: 0.12, earShape: 0, earSize: 1, tailLength: 0.28, tailUp: 0.75,
  colors: { base: '#E3A857', belly: '#F7E3BC', ear: '#B9772F', muzzle: '#F7E3BC', paws: '#F7E3BC', tailTip: '#F7E3BC', nose: '#2A1C18', eye: '#120C0A' },
};

type V3 = [number, number, number];
interface Prim { bone: string; c: V3; r: V3; kind: 0 | 1 | 2; color: string; seam: 0 | 1 | 2 } // kind: 0 fur, 1 eye, 2 nose

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Traits -> primitives + the 7-bone quadruped rig the dog clips drive (root, head, tail, legFL/FR/BL/BR). +Z is the nose. */
export function plushDog(t: PlushTraits) {
  const { bodyLength: L, girth: g, legLength: l, headSize: h, snout: s, earShape: e, earSize: es, colors: C } = t;
  const by = l + g * 0.85, k = g / 0.26, zf = L / 2 - g * 0.75, lx = g * 0.55;
  const head: V3 = [0, by + g * 0.7 + h * 0.4, L / 2 + h * 0.3];
  const snoutC: V3 = [0, head[1] - h * 0.28, head[2] + h * 0.72 + s * 0.45];
  const snoutR: V3 = [h * 0.52, h * 0.42, s * 0.9 + 0.05];
  const prims: Prim[] = [
    { bone: 'root', c: [0, by, 0], r: [g, g * 0.95, L / 2], kind: 0, color: C.base, seam: 1 },
    { bone: 'root', c: [0, by, zf + g * 0.1], r: [g * 1.03, g * 1.02, g * 1.02], kind: 0, color: C.base, seam: 1 },       // chest
    { bone: 'root', c: [0, by, -zf - g * 0.05], r: [g * 1.02, g * 1.02, g * 1.02], kind: 0, color: C.base, seam: 1 },    // rump
    { bone: 'root', c: [0, by - g * 0.45, 0], r: [g * 0.82, g * 0.6, L / 2 * 0.85], kind: 0, color: C.belly, seam: 0 },  // belly patch
    { bone: 'root', c: [0, by + g * 0.45, L / 2 - g * 0.05], r: [g * 0.72, g * 0.72, g * 0.72], kind: 0, color: C.base, seam: 0 }, // neck
    { bone: 'head', c: head, r: [h * 1.05, h * 0.95, h * 0.95], kind: 0, color: C.base, seam: 0 },
    { bone: 'head', c: snoutC, r: snoutR, kind: 0, color: C.muzzle, seam: 2 },
    { bone: 'head', c: [0, snoutC[1] + snoutR[1] * 0.45, snoutC[2] + snoutR[2] * 0.85], r: [h * 0.2, h * 0.15, h * 0.13], kind: 2, color: C.nose, seam: 0 },
  ];
  for (const sx of [1, -1]) {
    prims.push({ bone: 'head', c: [sx * h * 0.44, head[1] + h * 0.16, head[2] + h * 0.78], r: [h * 0.185, h * 0.185, h * 0.185], kind: 1, color: C.eye, seam: 0 });
    // ear: slides from a hanging flap on the side of the head (0) to an upright point on top (1)
    prims.push({
      bone: 'head', kind: 0, color: C.ear, seam: 0,
      c: lerp3([sx * h * 0.98, head[1] - h * 0.18, head[2] - h * 0.05], [sx * h * 0.58, head[1] + h * 0.92, head[2] - h * 0.1], e),
      r: lerp3([h * 0.2, h * 0.62 * es, h * 0.44 * es], [h * 0.25 * es, h * 0.5 * es, h * 0.17], e),
    });
    for (const [name, z] of [['F', zf], ['B', -zf]] as const) {
      const bone = `leg${name}${sx > 0 ? 'L' : 'R'}`;
      prims.push({ bone, c: [sx * lx, l * 0.55, z], r: [0.088 * k, l * 0.62, 0.092 * k], kind: 0, color: C.base, seam: 0 });
      prims.push({ bone, c: [sx * lx, 0.052, z + 0.03], r: [0.1 * k, 0.052, 0.125 * k], kind: 0, color: C.paws, seam: 0 }); // paw
    }
  }
  // tail: three balls along a direction between "hangs back" and "carried up"
  const tb: V3 = [0, by + g * 0.45, -L / 2 + g * 0.1], up = t.tailUp, dl = Math.hypot(up, 1 - up * 0.6);
  const td: V3 = [0, up / dl, -(1 - up * 0.6) / dl], at = (f: number): V3 => [0, tb[1] + td[1] * t.tailLength * f, tb[2] + td[2] * t.tailLength * f];
  prims.push({ bone: 'tail', c: at(0.25), r: [0.072, 0.072, 0.072], kind: 0, color: C.base, seam: 0 });
  prims.push({ bone: 'tail', c: at(0.6), r: [0.068, 0.068, 0.068], kind: 0, color: C.base, seam: 0 });
  prims.push({ bone: 'tail', c: at(1), r: [0.082, 0.082, 0.082], kind: 0, color: C.tailTip, seam: 0 });

  let bones: Bone[] = [
    { name: 'root', parent: -1, head: [0, by, -L * 0.1], tail: [0, by, L * 0.3] },
    { name: 'head', parent: 0, head: [0, by + g * 0.5, L / 2 - g * 0.1], tail: [0, snoutC[1], snoutC[2] + snoutR[2]] },
    { name: 'tail', parent: 0, head: tb, tail: at(1) },
    { name: 'legFL', parent: 0, head: [lx, l + g * 0.1, zf], tail: [lx, 0, zf] },
    { name: 'legFR', parent: 0, head: [-lx, l + g * 0.1, zf], tail: [-lx, 0, zf] },
    { name: 'legBL', parent: 0, head: [lx, l + g * 0.1, -zf], tail: [lx, 0, -zf] },
    { name: 'legBR', parent: 0, head: [-lx, l + g * 0.1, -zf], tail: [-lx, 0, -zf] },
  ];
  // normalise: the tallest point becomes height 1 (the Engine scales a 1-unit pet to metres)
  const k1 = 1 / Math.max(...prims.map(p => p.c[1] + p.r[1]));
  const sc = (v: V3): V3 => [v[0] * k1, v[1] * k1, v[2] * k1];
  for (const p of prims) { p.c = sc(p.c); p.r = sc(p.r); }
  bones = bones.map(b => ({ ...b, head: sc(b.head), tail: sc(b.tail) }));
  const ext = (i: number, sgn: number) => Math.max(...prims.map(p => sgn * p.c[i] + p.r[i]));
  return { prims, bones, min: [-ext(0, -1), 0, -ext(2, -1)] as V3, max: [ext(0, 1), 1, ext(2, 1)] as V3 };
}

const vert = /* glsl */ `
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vP;
void main() { vP = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`;

const frag = (np: number, nb: number) => /* glsl */ `
precision highp float;
#define NP ${np}
#define NB ${nb}
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform mat4 uInv[NB];      // posed model space -> each bone's rest space
uniform vec4 uC[NP];        // rest centre, bone index
uniform vec4 uR[NP];        // radii, kind (0 fur, 1 eye, 2 nose)
uniform vec4 uCol[NP];      // colour, seam group (1 body, 2 muzzle)
uniform vec3 uCam, uLight, uTint, uBMin, uBMax;
in vec3 vP;
out vec4 outColor;

float ell(vec3 p, vec3 r) { float k0 = length(p / r); if (k0 < 1e-4) return -min(r.x, min(r.y, r.z)); return k0 * (k0 - 1.) / length(p / (r * r)); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }

// x: distance, y: material (0 fur, 1 eye, 2 nose)
vec2 map(vec3 p) {
  vec3 q[NB];
  for (int b = 0; b < NB; b++) q[b] = (uInv[b] * vec4(p, 1.)).xyz;
  float fur = 1e3, hard = 1e3, mat = 0.;
  for (int i = 0; i < NP; i++) {
    float d = ell(q[int(uC[i].w)] - uC[i].xyz, uR[i].xyz);
    if (uR[i].w < .5) fur = smin(fur, d, .07);
    else if (d < hard) { hard = d; mat = uR[i].w; }
  }
  return hard < fur ? vec2(hard, mat) : vec2(fur, 0.);
}

// coat colour: each fur piece votes with a weight that falls off with distance; also returns seam weights
vec3 coat(vec3 p, out vec2 seam, out vec3 qRoot, out vec3 qHead) {
  vec3 q[NB];
  for (int b = 0; b < NB; b++) q[b] = (uInv[b] * vec4(p, 1.)).xyz;
  qRoot = q[0]; qHead = q[1];
  vec3 c = vec3(0.); float w = 0.; seam = vec2(0.);
  for (int i = 0; i < NP; i++) {
    if (uR[i].w > .5) continue;
    float d = max(ell(q[int(uC[i].w)] - uC[i].xyz, uR[i].xyz), 0.);
    float wi = exp(-d * 55.);
    c += uCol[i].rgb * wi; w += wi;
    if (uCol[i].w > .5 && uCol[i].w < 1.5) seam.x += wi;
    if (uCol[i].w > 1.5) seam.y += wi;
  }
  seam /= max(w, 1e-4);
  return c / max(w, 1e-4);
}

float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 normalAt(vec3 p) {
  const vec2 e = vec2(1, -1) * .0015;
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}
float depthOf(vec3 p) { vec4 c = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.); return c.z / c.w * .5 + .5; }

void main() {
  vec3 ro = uCam, rd = normalize(vP - uCam);
  vec3 t0 = (uBMin - ro) / rd, t1 = (uBMax - ro) / rd, tn3 = min(t0, t1), tf3 = max(t0, t1);
  float t = max(max(tn3.x, max(tn3.y, tn3.z)), 0.), tf = min(tf3.x, min(tf3.y, tf3.z));
  float near = 1e3, tNear = t; vec2 m = vec2(1e3, 0.); bool hit = false;
  for (int i = 0; i < 72 && t < tf; i++) {
    m = map(ro + rd * t);
    if (m.x < near) { near = m.x; tNear = t; }
    if (m.x < .0012) { hit = true; break; }
    t += m.x * .7; // under-step: the ellipsoid distance is only a bound, and thin ears overshoot otherwise
  }
  if (!hit && t < tf) hit = true; // ran out of steps while grazing a surface: shade it here rather than show a see-through seam
  if (!hit && near > .028) discard;
  vec3 p = ro + rd * (hit ? t : tNear), v = -rd;
  vec2 seam; vec3 qr, qh;
  vec3 base = coat(p, seam, qr, qh);
  if (!hit) { // fuzz halo: the silhouette fades out instead of ending in a hard edge
    float a = smoothstep(.028, 0., near) * .5;
    outColor = vec4(base * 1.12 * uTint * a, a);
    gl_FragDepth = depthOf(p);
    return;
  }
  vec3 n = normalAt(p);
  float ao = 1.;
  for (int i = 1; i <= 3; i++) { float hh = .035 * float(i); ao -= (hh - map(p + n * hh).x) * (1.6 / float(i)); }
  ao = clamp(ao, .35, 1.);
  vec3 col;
  if (m.y > .5) { // button eyes and nose: dark and glossy
    vec3 hv = normalize(uLight + v);
    float spec = pow(max(dot(n, hv), 0.), 70.) * 1.4 + pow(1. - max(dot(n, v), 0.), 4.) * .25;
    col = (m.y > 1.5 ? vec3(.16, .11, .1) : vec3(.07, .05, .045)) * (.5 + .5 * max(dot(n, uLight), 0.)) + spec;
  } else {
    // short fur: jitter the normal, wrap the light around the form, brighten the grazing edge
    vec3 fz = vec3(noise(p * 85.), noise(p * 85. + 17.), noise(p * 85. + 31.)) - .5;
    vec3 nf = normalize(n + fz * .38);
    float diff = clamp((dot(nf, uLight) + .55) / 1.55, 0., 1.);
    float sky = .5 + .5 * n.y;
    float rim = pow(1. - max(dot(n, v), 0.), 2.6);
    col = base * (.42 + .16 * sky + .62 * diff) * mix(.9, 1.06, noise(p * 140.)) * ao;
    col += (base * .6 + .25) * rim * .42;
    // stitching: a dashed seam down the back and under the muzzle
    float back = step(abs(qr.x), .006) * step(fract(qr.z * 34.), .6) * step(.6, seam.x) * step(.25, n.y);
    float chin = step(abs(qh.x), .005) * step(fract(qh.y * 46.), .6) * step(.55, seam.y);
    col *= 1. - .3 * max(back, chin);
  }
  outColor = vec4(col * uTint, 1.);
  gl_FragDepth = depthOf(p);
}`;

export class SdfPet {
  readonly mesh: THREE.Mesh;
  readonly bones: Bone[];
  readonly uniforms: {
    uBones: { value: THREE.Matrix4[] }; uInv: { value: THREE.Matrix4[] }; uC: { value: THREE.Vector4[] }; uR: { value: THREE.Vector4[] };
    uCol: { value: THREE.Vector4[] }; uCam: { value: THREE.Vector3 }; uLight: { value: THREE.Vector3 }; uTint: { value: THREE.Vector3 };
    uBMin: { value: THREE.Vector3 }; uBMax: { value: THREE.Vector3 };
  };
  private eyes: { i: number; ry: number }[] = [];
  private size = new THREE.Vector2();
  private nextBlink = 2;
  private inv = new THREE.Matrix4();

  constructor(traits: PlushTraits = DEFAULT_PLUSH) {
    const d = plushDog(traits);
    this.bones = d.bones;
    const pad = 0.4; // room for a swinging leg, a raised head, a wagging tail
    const min = new THREE.Vector3(...d.min).subScalar(pad), max = new THREE.Vector3(...d.max).addScalar(pad);
    this.size.set(d.max[0] - d.min[0], d.max[2] - d.min[2]);
    const bi = (n: string) => Math.max(0, d.bones.findIndex(b => b.name === n));
    this.uniforms = {
      uBones: { value: Array.from({ length: MAX_BONES }, () => new THREE.Matrix4()) },
      uInv: { value: d.bones.map(() => new THREE.Matrix4()) },
      uC: { value: d.prims.map(p => new THREE.Vector4(...p.c, bi(p.bone))) },
      uR: { value: d.prims.map(p => new THREE.Vector4(...p.r, p.kind)) },
      uCol: { value: d.prims.map(p => { const c = new THREE.Color(p.color).convertLinearToSRGB(); return new THREE.Vector4(c.r, c.g, c.b, p.seam); }) },
      uCam: { value: new THREE.Vector3() }, uLight: { value: new THREE.Vector3(0, 1, 0) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uBMin: { value: min }, uBMax: { value: max },
    };
    d.prims.forEach((p, i) => { if (p.kind === 1) this.eyes.push({ i, ry: p.r[1] }); });
    const geo = new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z).translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag(d.prims.length, d.bones.length), uniforms: this.uniforms,
      side: THREE.BackSide, // back faces: the box still covers the pet when the camera is inside it
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  /** x width, y = z length of the rest pose (same contract as SplatMesh.footprint). */
  footprint() { return this.size.clone(); }
  setBudget(_n: number) { /* no splats to budget */ }
  /** With depth on, the plush dog also writes depth, so room furniture occludes it correctly and it occludes the floor. */
  setDepthTest(on: boolean) { const m = this.mesh.material as THREE.RawShaderMaterial; m.depthTest = on; m.depthWrite = on; m.needsUpdate = true; }

  update(_renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const u = this.uniforms;
    for (let i = 0; i < u.uInv.value.length; i++) u.uInv.value[i].copy(u.uBones.value[i]).invert();
    this.inv.copy(this.mesh.matrixWorld).invert();
    u.uCam.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inv);
    // key light from above and slightly toward the viewer, in the pet's own space so it stays put as the pet turns
    u.uLight.value.copy(u.uCam.value).setY(0).normalize().multiplyScalar(0.55).add(new THREE.Vector3(0.35, 0.9, 0)).normalize();
    // blink: squash the eyes shut for ~130 ms every few seconds
    const t = performance.now() / 1000;
    if (t > this.nextBlink + 0.13) this.nextBlink = t + 2 + Math.random() * 3.5;
    const shut = t > this.nextBlink ? 0.12 : 1;
    for (const e of this.eyes) u.uR.value[e.i].y = e.ry * shut;
  }
}
