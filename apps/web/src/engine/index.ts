import * as THREE from 'three';
import type { ActionStep, BusEvent, LocalIntent, Mode, Mood, PetBundle, PetEngine, Platform, RunEvent, Species } from '@fetch/contracts';
import { Bus } from './bus';
import { MAX_BONES, SplatMesh } from './splatRenderer';

interface Bone { name: string; parent: number; head: [number, number, number]; tail: [number, number, number] }

export class Engine implements PetEngine {
  private bus = new Bus();
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  private splat?: SplatMesh;
  private bones: Bone[] = [];
  private pose: THREE.Quaternion[] = []; // local rotation per bone, about its rest-pose head
  private mode: Mode = 'work';
  private platforms: Platform[] = [];
  private raf = 0;
  onFrame?: (t: number) => void;

  mount(canvas: HTMLCanvasElement, _peekCanvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(1.6, 1.0, 2.4);
    this.camera.lookAt(0, 0.5, 0);
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.resize();
      this.onFrame?.(t / 1000);
      if (this.splat) {
        this.skin();
        this.splat.update(this.renderer, this.camera);
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
    this.bus.emit({ type: 'ENGINE_READY' });
  }

  async loadPet(b: PetBundle) {
    const [splat, weights, rig] = await Promise.all([
      fetch(b.splatUrl).then(r => r.arrayBuffer()),
      fetch(b.weightsUrl).then(r => r.arrayBuffer()),
      fetch(b.rigUrl).then(r => r.json()),
    ]);
    if (rig.bones.length > MAX_BONES) throw new Error(`rig has ${rig.bones.length} bones, max ${MAX_BONES}`);
    if (this.splat) this.scene.remove(this.splat.mesh);
    this.bones = rig.bones;
    this.pose = this.bones.map(() => new THREE.Quaternion());
    this.splat = new SplatMesh(splat, weights);
    this.scene.add(this.splat.mesh);
  }

  /** Demo/animation hook: set a bone's local rotation (euler radians) by name. */
  setBoneEuler(name: string, x: number, y: number, z: number) {
    const i = this.bones.findIndex(b => b.name === name);
    if (i >= 0) this.pose[i].setFromEuler(new THREE.Euler(x, y, z));
  }

  // World skin matrix per bone: M_b = M_parent * T(h) * R * T(-h), h = rest-pose head (parents listed before children).
  private skin() {
    const world: THREE.Matrix4[] = [];
    const out = this.splat!.uniforms.uBones.value;
    this.bones.forEach((b, i) => {
      const h = new THREE.Vector3(...b.head);
      const m = new THREE.Matrix4().makeTranslation(h.x, h.y, h.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(this.pose[i]))
        .multiply(new THREE.Matrix4().makeTranslation(-h.x, -h.y, -h.z));
      world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(m) : m;
      out[i].copy(world[i]);
    });
  }

  private resize() {
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * devicePixelRatio || c.height !== h * devicePixelRatio) {
      this.renderer.setPixelRatio(devicePixelRatio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); }

  // --- PetEngine surface; F1 slice 0-5h implements loading/skinning only. TODOs land in later slices. ---
  setMode(mode: Mode) { this.mode = mode; }
  setPlatforms(p: Platform[]) { this.platforms = p; }
  runPlan(_steps: ActionStep[]) { /* TODO: exit anim on run.plan */ }
  pushToolEvent(_e: RunEvent) { /* TODO: edge-peek */ }
  showResult(_prop: ActionStep['prop'], _mood: Mood) { /* TODO */ }
  setApprovalPending(_pending: boolean) { /* TODO */ }
  doIntent(_i: LocalIntent) { /* TODO: behavior state machine */ }
  setSpeaking(_amplitude: number) { /* TODO */ }
  generatePet(_input: { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string },
              _onProgress: (p: { stage: string; pct: number }) => void): Promise<PetBundle> {
    return Promise.reject(new Error('generatePet not implemented yet'));
  }
  on<T extends BusEvent['type']>(t: T, cb: (e: Extract<BusEvent, { type: T }>) => void) { this.bus.on(t, cb); }
}
