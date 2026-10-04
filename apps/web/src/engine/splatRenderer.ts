// Minimal custom Gaussian-splat renderer with linear-blend skinning in the vertex stage.
// Chosen over Spark to avoid depending on its shader-hook API; PRD 1.3 allows this fallback.
// Splat data lives in one float texture (6 texels/splat); the only per-sort upload is a 4 B/splat draw-order attribute,
// so a 300k re-sort is a counting sort + 1.2 MB upload instead of re-permuting every attribute.
// ponytail: depth sort uses rest-pose centers only (CPU, throttled, on camera-direction change); move to a worker / posed centers if overlap artifacts show.
import * as THREE from 'three';

export const MAX_BONES = 16;
const RW = 512; // splats per texture row (RW * 6 texels wide)

const vert = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform mat4 uBones[${MAX_BONES}];
uniform vec2 uViewport;
uniform vec2 uFocal;
uniform sampler2D uData;
in vec2 corner;
in float aIdx;
out vec4 vColor; out vec2 vPos;

vec4 fetch(int i, int k) { return texelFetch(uData, ivec2((i & ${RW - 1}) * 6 + k, i >> 9), 0); }

mat3 quatMat(vec4 q) { // q = (w,x,y,z)
  float w=q.x,x=q.y,y=q.z,z=q.w;
  return mat3(1.-2.*(y*y+z*z), 2.*(x*y+w*z), 2.*(x*z-w*y),
              2.*(x*y-w*z), 1.-2.*(x*x+z*z), 2.*(y*z+w*x),
              2.*(x*z+w*y), 2.*(y*z-w*x), 1.-2.*(x*x+y*y));
}
void main() {
  int i = int(aIdx);
  // per splat: A(cx cy cz sx) B(sy sz rw rx) C(ry rz cr cg) D(cb ca bi0 bi1) E(bi2 bi3 bw0 bw1) F(bw2 bw3 - -)
  vec4 A = fetch(i,0), Bt = fetch(i,1), C = fetch(i,2), D = fetch(i,3), E = fetch(i,4), F = fetch(i,5);
  vec3 aCenter = A.xyz, aScale = vec3(A.w, Bt.x, Bt.y);
  vec4 aRot = vec4(Bt.z, Bt.w, C.x, C.y), aColor = vec4(C.z, C.w, D.x, D.y), aBi = vec4(D.z, D.w, E.x, E.y), aBw = vec4(E.z, E.w, F.x, F.y);
  mat4 B = aBw.x*uBones[int(aBi.x)] + aBw.y*uBones[int(aBi.y)] + aBw.z*uBones[int(aBi.z)] + aBw.w*uBones[int(aBi.w)];
  vec4 cam = viewMatrix * modelMatrix * B * vec4(aCenter, 1.);
  if (cam.z > -0.05) { gl_Position = vec4(0., 0., 2., 1.); return; }
  float tz = -cam.z;
  // Jacobian of LBS is the blended 3x3, so the covariance is rotated with the bones (shear only from weight blending).
  mat3 M = mat3(modelMatrix) * mat3(B) * quatMat(normalize(aRot)) * mat3(aScale.x,0.,0., 0.,aScale.y,0., 0.,0.,aScale.z);
  mat3 W = mat3(viewMatrix);
  // J (2x3, rows = screen x/y, third row zero); GLSL mat3 is column-major
  mat3 J = mat3(uFocal.x/tz, 0., 0.,
                0., uFocal.y/tz, 0.,
                uFocal.x*cam.x/(tz*tz), uFocal.y*cam.y/(tz*tz), 0.);
  mat3 T = J * W * M;
  mat3 cov = T * transpose(T);
  float a = cov[0][0] + .3, b = cov[0][1], d = cov[1][1] + .3;
  float mid = .5*(a+d), r = length(vec2(.5*(a-d), b));
  float l1 = mid + r, l2 = max(mid - r, .1);
  vec2 v1 = normalize(vec2(b, l1 - a) + vec2(1e-6, 0.));
  vec2 ax1 = min(sqrt(2.*l1), 1024.) * v1;
  vec2 ax2 = min(sqrt(2.*l2), 1024.) * vec2(-v1.y, v1.x);
  vec4 clip = projectionMatrix * cam;
  vec2 ndc = clip.xy / clip.w;
  vPos = corner * 2.;
  vColor = aColor;
  gl_Position = vec4(ndc + (corner.x*ax1 + corner.y*ax2) * 2. / uViewport, clip.z/clip.w, 1.);
}`;

const frag = /* glsl */ `
precision highp float;
in vec4 vColor; in vec2 vPos; out vec4 outColor;
void main() {
  float A = -dot(vPos, vPos);
  if (A < -4.) discard;
  float a = exp(A) * vColor.a;
  outColor = vec4(vColor.rgb * a, a);
}`;

export class SplatMesh {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uBones: { value: Array.from({ length: MAX_BONES }, () => new THREE.Matrix4()) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uFocal: { value: new THREE.Vector2(1, 1) },
    uData: { value: null as THREE.DataTexture | null },
  };
  count: number;
  readonly total: number;
  /** Last CPU sort cost in ms (perf check; see acceptance.ts). */
  lastSortMs = 0;
  private lastSortAt = 0;
  private geo = new THREE.InstancedBufferGeometry();
  private centers: Float32Array; // pre-shuffled rest-pose centers (never permuted)
  private order: Float32Array;
  private orderAttr: THREE.InstancedBufferAttribute;
  private lastDir = new THREE.Vector3(9, 9, 9);

  // splat: .splat bytes (32B/splat: pos3f scale3f rgba4u8 rot4u8); weights: 8B/splat (4 idx + 4 weight)
  constructor(splat: ArrayBuffer, weights: ArrayBuffer) {
    const n = (this.count = this.total = splat.byteLength / 32);
    const f = new Float32Array(splat), u = new Uint8Array(splat), w = new Uint8Array(weights);
    // seeded shuffle so any prefix (quality budget) is an unbiased subsample
    const order = Uint32Array.from({ length: n }, (_, i) => i);
    let r = 1;
    for (let i = n - 1; i > 0; i--) { r = (r * 1664525 + 1013904223) >>> 0; const j = r % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const W = RW * 6, H = Math.ceil(n / RW), data = new Float32Array(W * H * 4);
    this.centers = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) {
      const s = order[j], o = ((j >> 9) * W + (j & (RW - 1)) * 6) * 4, q = (k: number) => (u[s * 32 + 28 + k] - 128) / 128;
      this.centers.set([f[s * 8], f[s * 8 + 1], f[s * 8 + 2]], j * 3);
      data.set([
        f[s * 8], f[s * 8 + 1], f[s * 8 + 2], f[s * 8 + 3],
        f[s * 8 + 4], f[s * 8 + 5], q(0), q(1),
        q(2), q(3), u[s * 32 + 24] / 255, u[s * 32 + 25] / 255,
        u[s * 32 + 26] / 255, u[s * 32 + 27] / 255, w[s * 8], w[s * 8 + 1],
        w[s * 8 + 2], w[s * 8 + 3], w[s * 8 + 4] / 255, w[s * 8 + 5] / 255,
        w[s * 8 + 6] / 255, w[s * 8 + 7] / 255, 0, 0,
      ], o);
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.uniforms.uData.value = tex;

    this.order = new Float32Array(n);
    this.orderAttr = new THREE.InstancedBufferAttribute(this.order, 1);
    this.orderAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // three requires one
    this.geo.setAttribute('aIdx', this.orderAttr);
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.instanceCount = n;
    for (let i = 0; i < n; i++) this.order[i] = i;
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  /** Render only the first `n` shuffled splats (quality `high` 300k / `low` 120k). */
  setBudget(n: number) {
    const c = Math.min(n, this.total);
    if (c === this.count) return;
    this.count = c;
    this.geo.instanceCount = c;
    for (let i = 0; i < c; i++) this.order[i] = i;
    this.orderAttr.needsUpdate = true;
    this.lastDir.set(9, 9, 9); // force resort
  }

  setDepthTest(on: boolean) { const material = this.mesh.material as THREE.RawShaderMaterial; material.depthTest = on; material.depthWrite = false; material.needsUpdate = true; }

  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.uniforms.uViewport.value.copy(size);
    const fy = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.uniforms.uFocal.value.set(fy, fy);
    const dir = camera.getWorldDirection(new THREE.Vector3()).transformDirection(this.mesh.matrixWorld.clone().invert()); // sort in model space
    if (dir.distanceTo(this.lastDir) > 0.01 && performance.now() - this.lastSortAt > 50) { this.lastDir.copy(dir); this.sort(dir); }
  }

  // 16-bit counting sort on depth: O(n), far first (back-to-front).
  private sort(dir: THREE.Vector3) {
    const t0 = performance.now();
    const n = this.count, c = this.centers, d = new Float32Array(n);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = c[i * 3] * dir.x + c[i * 3 + 1] * dir.y + c[i * 3 + 2] * dir.z;
      d[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const k = 65535 / (mx - mn || 1), counts = new Uint32Array(65537), key = new Uint16Array(n);
    for (let i = 0; i < n; i++) { const q = ((mx - d[i]) * k) | 0; key[i] = q; counts[q + 1]++; }
    for (let i = 0; i < 65536; i++) counts[i + 1] += counts[i];
    for (let i = 0; i < n; i++) this.order[counts[key[i]]++] = i;
    this.orderAttr.needsUpdate = true;
    this.lastSortMs = performance.now() - t0;
    this.lastSortAt = t0;
  }
}
