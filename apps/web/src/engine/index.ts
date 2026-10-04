import * as THREE from 'three';
import type { ActionStep, BusEvent, LocalIntent, Mode, Mood, PetBundle, PetEngine, Platform, RunEvent, Species } from '@fetch/contracts';
import { Bus } from './bus';
import { generatePet as runPipeline } from './pipeline/generate';
import { Behavior, type BehaviorHost } from './behavior';
import { Props, type Prop } from './props';
import { PACKS, type SpeciesPack } from './species';
import { MAX_BONES, SplatMesh } from './splatRenderer';

interface Bone { name: string; parent: number; head: [number, number, number]; tail: [number, number, number] }

export type Quality = 'high' | 'low';
const BUDGET: Record<Quality, number> = { high: 300_000, low: 120_000 };

// Ray vs capsule (segment + radius): true if the closest distance between the ray and the segment <= r.
function rayHitsCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const u = d, v = b.clone().sub(a), w = o.clone().sub(a);
  const bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w), den = cc - bb * bb; // |u|=1
  let t = den > 1e-9 ? (bb * ee - cc * dd) / den : 0, s = cc > 0 ? (ee + bb * t) / cc : 0;
  s = Math.max(0, Math.min(1, s)); t = Math.max(0, u.dot(a.clone().addScaledVector(v, s).sub(o)));
  return o.clone().addScaledVector(u, t).distanceTo(a.clone().addScaledVector(v, s)) <= r;
}

export interface EngineOptions { apiBase?: string }

export class Engine implements PetEngine {
  constructor(private opts: EngineOptions = {}) {}
  private quality: Quality = 'high';
  private lowSince = 0;
  private boneWorld: THREE.Matrix4[] = [];
  private shadow?: THREE.Mesh;
  private beh?: Behavior;
  private pack?: SpeciesPack;
  private props?: Props;
  private listeningPending = false;

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
    this.camera.position.set(0, 0.8, 4.5); // near-frontal so screen x maps to world x on the z=0 stage
    this.camera.lookAt(0, 0.5, 0);
    this.shadow = this.makeShadow();
    this.scene.add(this.shadow);
    this.props = new Props(this.scene);
    canvas.style.pointerEvents = 'none';
    window.addEventListener('pointermove', e => {
      canvas.style.pointerEvents = this.hitTest(e.clientX, e.clientY) ? 'auto' : 'none';
    });
    let prev = 0;
    const loop = (t: number) => {
      const dt = t / 1000 - prev; prev = t / 1000;
      this.watchFps(dt);
      this.raf = requestAnimationFrame(loop);
      this.resize();
      this.onFrame?.(t / 1000);
      if (this.splat) {
        if (this.beh) this.tickBehavior(Math.min(dt, 0.1));
        this.skin();
        this.splat.mesh.updateMatrixWorld();
        this.splat.update(this.renderer, this.camera);
        this.props?.update(dt, this.beh && this.splat.mesh.visible ? this.socketWorld() : undefined);
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
    this.splat.setBudget(BUDGET[this.quality]);
    this.scene.add(this.splat.mesh);
    this.pack = PACKS[b.species];
    this.beh = new Behavior(this.pack, this.host());
    this.beh.setMode(this.mode);
    if (this.listeningPending) this.beh.setListening(true);
  }

  private tickBehavior(dt: number) {
    const o = this.beh!.update(dt), m = this.splat!.mesh;
    for (const b of this.bones) this.setBoneEuler(b.name, 0, 0, 0);
    for (const [n, e] of Object.entries(o.pose.bones)) this.setBoneEuler(n, e[0], e[1], e[2]);
    m.position.set(o.x, o.y, 0);
    m.rotation.y = o.yaw;
    if (this.shadow) { this.shadow.position.set(o.x, this.beh!.y + 0.002, 0); this.shadow.visible = m.visible; }
  }

  // World position of the species' carry socket (mouth / cheek / talons), from the posed bone.
  private socketWorld(): THREE.Vector3 | undefined {
    const c = this.pack!.carry, i = this.bones.findIndex(b => b.name === c.bone);
    if (i < 0 || !this.boneWorld[i]) return undefined;
    return new THREE.Vector3(...this.bones[i].tail).add(new THREE.Vector3(...c.offset)).applyMatrix4(this.boneWorld[i]).applyMatrix4(this.splat!.mesh.matrixWorld);
  }

  // Screen px -> point on the z=0 world plane the pet walks on.
  private toWorld(px: number, py: number): THREE.Vector3 | undefined {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1), this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3()) ?? undefined;
  }

  private host(): BehaviorHost {
    return {
      bounds: () => {
        const r = this.renderer.domElement.getBoundingClientRect();
        const a = this.toWorld(r.left + 4, r.top + r.height / 2), b = this.toWorld(r.right - 4, r.top + r.height / 2);
        return { xmin: a?.x ?? -2, xmax: b?.x ?? 2 };
      },
      platformSpots: () => this.platforms.filter(p => p.kind !== 'edge').flatMap(p => {
        const w = this.toWorld(p.x + p.w / 2, p.y);
        return w ? [{ id: p.id, x: w.x, y: Math.max(0, w.y) }] : [];
      }),
      setVisible: v => { if (this.splat) this.splat.mesh.visible = v; },
      emit: e => this.bus.emit(e),
      burst: (k, x, y) => this.props?.burst(k, new THREE.Vector3(x, y, 0.1)),
      setCarry: p => this.props?.setCarry(p),
      setWorldProp: (p, x, y) => this.props?.setWorld(p, x === undefined ? undefined : new THREE.Vector3(x, y ?? 0, 0.2)),
      peek: e => this.peekEvents.push(e), // TODO 1.9: render in the edge-peek canvas
    };
  }
  /** Run events seen while the pet is off-canvas; the edge-peek scene (1.9) consumes these. */
  peekEvents: RunEvent[] = [];

  /** F2 signals mic-open/close (not in the frozen BusEvent contract; propose adding a MIC event). */
  setListening(on: boolean) { this.listeningPending = on; this.beh?.setListening(on); }
  /** Pointer reactions (PET_STROKE/POKE/FEED are detected in 1.8; this is the reaction half). */
  react(kind: 'pet' | 'poke' | 'feed') { this.beh?.react(kind); }
  /** Play a verb's composed animation on the visible pet (peek scene / previews). */
  previewVerb(v: Parameters<Behavior['previewVerb']>[0], mood: Mood = 'neutral', secs = 3, prop?: Prop) { this.beh?.previewVerb(v, mood, secs, prop); }
  get state() { return this.beh?.state; }

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
    this.boneWorld = world;
  }

  /** F2 settings: splat budget. Auto-drops to `low` if fps < 24 for 3s. */
  setQuality(q: Quality) { this.quality = q; this.lowSince = 0; this.splat?.setBudget(BUDGET[q]); }

  private watchFps(dt: number) {
    if (!dt || this.quality === 'low') return;
    if (1 / dt >= 24) { this.lowSince = 0; return; }
    this.lowSince += dt;
    if (this.lowSince > 3) this.setQuality('low');
  }

  /** Cheap hit proxy: one capsule per posed bone. Lets F2's page stay clickable under the full-page canvas. */
  hitTest(clientX: number, clientY: number): boolean {
    if (!this.splat || !this.boneWorld.length) return false;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const inv = this.splat.mesh.matrixWorld.clone().invert(); // bones live in the pet's local space
    if (!this.splat.mesh.visible) return false;
    ray.ray.origin.applyMatrix4(inv); ray.ray.direction.transformDirection(inv);
    return this.bones.some((b, i) => {
      const len = new THREE.Vector3(...b.head).distanceTo(new THREE.Vector3(...b.tail));
      const a = new THREE.Vector3(...b.head).applyMatrix4(this.boneWorld[i]), e = new THREE.Vector3(...b.tail).applyMatrix4(this.boneWorld[i]);
      return rayHitsCapsule(ray.ray.origin, ray.ray.direction, a, e, Math.max(0.07, 0.2 * len));
    });
  }

  // Blob contact shadow decal on the ground plane (y=0).
  private makeShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.position.y = 0.002;
    m.renderOrder = -1;
    return m;
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
  setMode(mode: Mode) { this.mode = mode; this.beh?.setMode(mode); }
  setPlatforms(p: Platform[]) { this.platforms = p; }
  runPlan(steps: ActionStep[]) { this.peekEvents = []; this.beh?.runPlan(steps); }
  pushToolEvent(e: RunEvent) { this.beh?.pushToolEvent(e); }
  showResult(prop: ActionStep['prop'], mood: Mood) { this.beh?.showResult(prop, mood); }
  setApprovalPending(pending: boolean) { this.beh?.setApprovalPending(pending); }
  doIntent(i: LocalIntent) { this.beh?.doIntent(i); }
  setSpeaking(_amplitude: number) { /* TODO */ }
  generatePet(input: { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string },
              onProgress: (p: { stage: string; pct: number }) => void): Promise<PetBundle> {
    return runPipeline(this.opts.apiBase ?? '', input, onProgress, BUDGET[this.quality]);
  }
  on<T extends BusEvent['type']>(t: T, cb: (e: Extract<BusEvent, { type: T }>) => void) { this.bus.on(t, cb); }
}
