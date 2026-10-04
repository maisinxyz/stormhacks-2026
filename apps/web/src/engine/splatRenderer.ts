// Minimal custom Gaussian-splat renderer with linear-blend skinning in the vertex stage.
// Chosen over Spark to avoid depending on its shader-hook API; PRD 1.3 allows this fallback.
// ponytail: depth sort uses rest-pose centers only (CPU, on camera-direction change); move to a worker / posed centers if overlap artifacts show at 300k.
import * as THREE from 'three';

export const MAX_BONES = 16;

const vert = /* glsl */ `
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform mat4 uBones[${MAX_BONES}];
uniform vec2 uViewport;
uniform vec2 uFocal;
in vec2 corner;
in vec3 aCenter; in vec3 aScale; in vec4 aColor; in vec4 aRot; in vec4 aBi; in vec4 aBw;
out vec4 vColor; out vec2 vPos;

mat3 quatMat(vec4 q) { // q = (w,x,y,z)
  float w=q.x,x=q.y,y=q.z,z=q.w;
  return mat3(1.-2.*(y*y+z*z), 2.*(x*y+w*z), 2.*(x*z-w*y),
              2.*(x*y-w*z), 1.-2.*(x*x+z*z), 2.*(y*z+w*x),
              2.*(x*z+w*y), 2.*(y*z-w*x), 1.-2.*(x*x+y*y));
}
void main() {
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
  };
  count: number;
  readonly total: number;
  private base: Float32Array[] = []; // pre-shuffled full-resolution copy, so any prefix is a uniform subsample
  private geo = new THREE.InstancedBufferGeometry();
  private centers: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private lastDir = new THREE.Vector3(9, 9, 9);

  // splat: .splat bytes (32B/splat: pos3f scale3f rgba4u8 rot4u8); weights: 8B/splat (4 idx + 4 weight)
  constructor(splat: ArrayBuffer, weights: ArrayBuffer) {
    const n = (this.count = this.total = splat.byteLength / 32);
    const f = new Float32Array(splat), u = new Uint8Array(splat), w = new Uint8Array(weights);
    const center = new Float32Array(n * 3), scale = new Float32Array(n * 3), color = new Float32Array(n * 4),
      rot = new Float32Array(n * 4), bi = new Float32Array(n * 4), bw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) { center[i * 3 + k] = f[i * 8 + k]; scale[i * 3 + k] = f[i * 8 + 3 + k]; }
      for (let k = 0; k < 4; k++) {
        color[i * 4 + k] = u[i * 32 + 24 + k] / 255;
        rot[i * 4 + k] = (u[i * 32 + 28 + k] - 128) / 128;
        bi[i * 4 + k] = w[i * 8 + k];
        bw[i * 4 + k] = w[i * 8 + 4 + k] / 255;
      }
    }
    // seeded shuffle so a budget prefix is an unbiased subsample
    const order = Uint32Array.from({ length: n }, (_, i) => i);
    let r = 1;
    for (let i = n - 1; i > 0; i--) { r = (r * 1664525 + 1013904223) >>> 0; const j = r % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const arrs = [center, scale, color, rot, bi, bw], sizes = [3, 3, 4, 4, 4, 4];
    arrs.forEach((a, ai) => {
      const t = new Float32Array(a.length), s = sizes[ai];
      for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) t[i * s + k] = a[order[i] * s + k];
      a.set(t); this.base.push(t.slice());
    });
    this.centers = center.slice();
    this.geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // three requires one
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const add = (name: string, arr: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.attrs.push(a);
      this.geo.setAttribute(name, a);
    };
    add('aCenter', center, 3); add('aScale', scale, 3); add('aColor', color, 4);
    add('aRot', rot, 4); add('aBi', bi, 4); add('aBw', bw, 4);
    this.geo.instanceCount = n;
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** Render only the first `n` shuffled splats (quality `high` 300k / `low` 120k). */
  setBudget(n: number) {
    const c = Math.min(n, this.total);
    if (c === this.count) return;
    this.count = c;
    this.attrs.forEach((a, i) => { const s = a.itemSize; (a.array as Float32Array).set(this.base[i].subarray(0, c * s)); a.needsUpdate = true; });
    this.centers = this.base[0].slice(0, c * 3);
    this.geo.instanceCount = c;
    this.lastDir.set(9, 9, 9); // force resort
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.uniforms.uViewport.value.copy(size);
    const fy = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.uniforms.uFocal.value.set(fy, fy);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    if (dir.distanceTo(this.lastDir) > 0.01) { this.lastDir.copy(dir); this.sort(dir); }
  }

  private sort(dir: THREE.Vector3) {
    const n = this.count, c = this.centers, d = new Float32Array(n), idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) { d[i] = c[i * 3] * dir.x + c[i * 3 + 1] * dir.y + c[i * 3 + 2] * dir.z; idx[i] = i; }
    idx.sort((a, b) => d[b] - d[a]); // far first: back-to-front
    for (const a of this.attrs) {
      const s = a.itemSize, src = a.array as Float32Array, tmp = new Float32Array(src.length);
      for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) tmp[i * s + k] = src[idx[i] * s + k];
      src.set(tmp); a.needsUpdate = true;
      if (s === 3 && a === this.attrs[0]) this.centers = tmp;
    }
  }
}
