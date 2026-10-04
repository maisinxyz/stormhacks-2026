import * as THREE from 'three';
import type { ActionStep, BusEvent, LocalIntent, Mode, Mood, PetBundle, PetEngine, Platform, RunEvent, Species } from '@fetch/contracts';
import { Bus } from './bus';
import { generatePet as runPipeline } from './pipeline/generate';
import { Behavior, type BehaviorHost } from './behavior';
import { Interactions } from './interactions';
import { Needs, type Stats } from './needs';
import { Toys } from './toys';
import { PeekScene } from './peek';
import { Skeleton, type Bone } from './skeleton';
import { Props, type Prop } from './props';
import { PACKS, type FeedItem, type SpeciesPack } from './species';
import { MAX_BONES, SplatMesh } from './splatRenderer';


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
  private pr = Math.min(window.devicePixelRatio, 1.25); // splats are soft, so cap render scale; first fps rescue is dropping to 1.0
  private sk?: Skeleton;
  private peek?: PeekScene;
  private peekCanvas?: HTMLCanvasElement;
  private plan: ActionStep[] = [];
  private get boneWorld() { return this.sk?.world ?? []; }
  private get bones(): Bone[] { return this.sk?.bones ?? []; }
  private shadow?: THREE.Mesh;
  private beh?: Behavior;
  private pack?: SpeciesPack;
  private props?: Props;
  private listeningPending = false;
  private needs?: Needs;
  private toys?: Toys;
  private inter?: Interactions;
  private ring?: THREE.Sprite;
  private ringP = -1;
  private laser?: THREE.Sprite;
  private cursorAt?: { x: number; y: number; t: number };
  private approvalPending = false;
  private approvalActionId = '';
  private statsCb?: (s: Stats) => void;

  private bus = new Bus();
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  private splat?: SplatMesh;
  private mode: Mode = 'work';
  private platforms: Platform[] = [];
  private raf = 0;
  onFrame?: (t: number) => void;

  mount(canvas: HTMLCanvasElement, peekCanvas: HTMLCanvasElement) {
    this.peekCanvas = peekCanvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0.8, 4.5); // near-frontal so screen x maps to world x on the z=0 stage
    this.camera.lookAt(0, 0.5, 0);
    this.shadow = this.makeShadow();
    this.scene.add(this.shadow);
    this.props = new Props(this.scene);
    this.toys = new Toys(this.scene);
    this.toys.init().then(() => this.syncToyPlatforms());
    this.ring = this.makeRing();
    this.laser = this.makeLaser();
    this.inter = new Interactions(this.interactionHost());
    canvas.style.pointerEvents = 'none';
    window.addEventListener('pointermove', e => {
      canvas.style.pointerEvents = this.hitTest(e.clientX, e.clientY) || this.hitBall(e.clientX, e.clientY) ? 'auto' : 'none';
    });
    let prev = 0;
    const loop = (t: number) => {
      const dt = t / 1000 - prev; prev = t / 1000;
      this.watchFps(dt);
      this.raf = requestAnimationFrame(loop);
      this.resize();
      this.onFrame?.(t / 1000);
      this.toys?.step(Math.min(dt, 0.1));
      this.inter?.update(Math.min(dt, 0.1), t);
      this.updateLaser();
      this.peek?.update(Math.min(dt, 0.1));
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
    this.sk = new Skeleton(rig.bones);
    this.peek?.dispose();
    this.peek = this.peekCanvas && new PeekScene(this.peekCanvas, PACKS[b.species], splat, weights, rig.bones);
    this.splat = new SplatMesh(splat, weights);
    this.splat.setBudget(BUDGET[this.quality]);
    this.scene.add(this.splat.mesh);
    this.pack = PACKS[b.species];
    this.needs = new Needs(b.stats, s => this.statsCb?.(s));
    this.beh = new Behavior(this.pack, this.host(), this.needs);
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
      // pet off the main canvas == edge-peek on (and vice versa)
      setVisible: v => { if (this.splat) this.splat.mesh.visible = v; this.peek?.setActive(!v); },
      emit: e => this.bus.emit(e),
      burst: (k, x, y) => this.props?.burst(k, new THREE.Vector3(x, y, 0.1)),
      setCarry: p => this.props?.setCarry(p),
      setWorldProp: (p, x, y) => this.props?.setWorld(p, x === undefined ? undefined : new THREE.Vector3(x, y ?? 0, 0.2)),
      peek: e => this.peekEvents.push(e), // TODO 1.9: render in the edge-peek canvas
      ball: () => this.toys?.present ? { ...this.toys.pos, resting: this.toys.resting, held: this.toys.held } : undefined,
      takeBall: () => this.toys?.take(),
      dropBall: (x, y) => this.toys?.drop(x, y),
    };
  }

  // ---- 1.8 pointer interactions: host glue ----
  private interactionHost() {
    return {
      hitPet: (x: number, y: number) => this.hitTest(x, y),
      hitBall: (x: number, y: number) => this.hitBall(x, y),
      toWorld: (x: number, y: number) => this.toWorld(x, y),
      emit: (e: BusEvent) => this.bus.emit(e),
      react: (k: 'pet' | 'poke' | 'feed') => this.beh?.react(k),
      petted: (i: number, dt: number) => this.needs?.petted(i, dt),
      feed: (item: FeedItem) => this.feedItem(item),
      holdBall: (x: number, y: number) => this.toys?.hold(x, y),
      releaseBall: (vx: number, vy: number) => { this.toys?.release(vx, vy); this.beh?.fetchBall(); },
      point: (x: number) => this.beh?.pointTo(x),
      cursor: (x: number, y: number) => { this.cursorAt = { x, y, t: performance.now() }; this.beh?.setCursor(x, y); },
      approval: () => ({ pending: this.approvalPending, actionId: this.approvalActionId }),
      setRing: (p: number) => this.setRing(p),
      mode: () => this.mode,
    };
  }

  private hitBall(x: number, y: number) {
    if (!this.toys?.hittable) return false;
    const w = this.toWorld(x, y), b = this.toys.pos;
    return !!w && Math.hypot(w.x - b.x, w.y - b.y) < 0.2;
  }

  /** Species food check; wrong food is ignored. Resets hunger. */
  feedItem(item: FeedItem) {
    if (!this.pack?.foods.includes(item)) return false;
    this.needs?.fed();
    return true;
  }

  /** F2 Toy Box: put the ball on stage (optionally with a toss). */
  spawnBall(x = -1, y = 1.2, vx = 0, vy = 0) { this.toys?.spawn(x, y); if (vx || vy) { this.toys?.release(vx, vy); this.beh?.fetchBall(); } }
  /** F2 treat tray (non-HTML5 drag): call on pointer-up over the canvas. */
  dropFood(item: FeedItem, x: number, y: number) { return this.inter?.dropFood(item, x, y) ?? false; }
  /** F2 POINT (screen px). */
  pointAt(x: number, y: number) { this.inter?.point(x, y); }
  /** Stat changes for F2 to persist via PATCH /pets/:id (not in the frozen BusEvent contract). */
  onStats(cb: (s: Stats) => void) { this.statsCb = cb; }
  get stats() { return this.needs?.stats; }

  private syncToyPlatforms() {
    if (!this.toys || !this.renderer) return;
    const b = this.host().bounds();
    this.toys.setPlatforms(this.platforms.filter(p => p.kind !== 'edge').flatMap(p => {
      const l = this.toWorld(p.x, p.y), r = this.toWorld(p.x + p.w, p.y);
      return l && r ? [{ x: (l.x + r.x) / 2, y: Math.max(0, l.y), w: Math.abs(r.x - l.x) }] : [];
    }), b);
  }

  // Ring above the pet that fills during a pet-to-approve stroke.
  private makeRing() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(0.45); s.renderOrder = 12; s.visible = false;
    this.scene.add(s);
    return s;
  }
  private setRing(p: number) {
    if (!this.ring || p === this.ringP) return;
    this.ringP = p;
    this.ring.visible = p > 0;
    const m = this.ring.material, c = m.map!.image as HTMLCanvasElement, x = c.getContext('2d')!;
    x.clearRect(0, 0, 128, 128);
    x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,0.15)'; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#2f9e44'; x.lineCap = 'round'; x.beginPath(); x.arc(64, 64, 50, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); x.stroke();
    m.map!.needsUpdate = true;
  }

  private makeLaser() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,40,40,1)'); g.addColorStop(0.4, 'rgba(255,40,40,0.8)'); g.addColorStop(1, 'rgba(255,40,40,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    s.scale.setScalar(0.12); s.renderOrder = 11; s.visible = false;
    this.scene.add(s);
    return s;
  }
  private updateLaser() {
    const c = this.cursorAt, on = !!c && this.mode === 'play' && (this.pack?.id === 'cat' || this.pack?.id === 'bird') && performance.now() - c.t < 3000;
    if (this.laser) { this.laser.visible = on; if (on) this.laser.position.set(c!.x, c!.y, 0.2); }
    if (this.ring && this.ring.visible && this.splat) this.ring.position.set(this.splat.mesh.position.x, this.splat.mesh.position.y + 1.25, 0.3);
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
  setBoneEuler(name: string, x: number, y: number, z: number) { this.sk?.setEuler(name, x, y, z); }

  private skin() { this.sk!.update(this.splat!.uniforms.uBones.value); }

  /** F2 settings: splat budget. Auto-drops to `low` if fps < 24 for 3s. */
  setQuality(q: Quality) { this.quality = q; this.lowSince = 0; this.splat?.setBudget(BUDGET[q]); }

  private watchFps(dt: number) {
    if (!dt || this.quality === 'low') return;
    if (1 / dt >= 24) { this.lowSince = 0; return; }
    this.lowSince += dt;
    if (this.lowSince > 3) {
      this.lowSince = 0;
      if (this.pr > 1) this.pr = 1; // stage 1: lower render scale
      else this.setQuality('low');  // stage 2: 120k budget
    }
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
      return rayHitsCapsule(ray.ray.origin, ray.ray.direction, a, e, Math.max(0.14, 0.3 * len));
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
    if (c.width !== Math.round(w * this.pr) || c.height !== Math.round(h * this.pr)) {
      this.renderer.setPixelRatio(this.pr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); }

  // --- PetEngine surface; F1 slice 0-5h implements loading/skinning only. TODOs land in later slices. ---
  setMode(mode: Mode) { this.mode = mode; this.beh?.setMode(mode); }
  setPlatforms(p: Platform[]) { this.platforms = p; this.syncToyPlatforms(); }
  runPlan(steps: ActionStep[]) { this.pushToolEvent({ type: 'run.plan', steps }); }
  pushToolEvent(e: RunEvent) {
    if (e.type === 'approval.required') this.approvalActionId = e.actionId;
    if (e.type === 'run.plan') { this.plan = e.steps; this.peekEvents = []; }
    this.peek?.handle(e, id => this.plan.find(s => s.id === id)); // edge-peek mirrors every event 1:1
    this.beh?.pushToolEvent(e);
  }
  /** Reaction log of the edge-peek scene (one entry per run event it reacted to). */
  get peekLog() { return this.peek?.log ?? []; }
  showResult(prop: ActionStep['prop'], mood: Mood) { this.beh?.showResult(prop, mood); }
  setApprovalPending(pending: boolean) { this.approvalPending = pending; this.beh?.setApprovalPending(pending); }
  doIntent(i: LocalIntent) {
    if (i === 'fetch_ball' && this.pack?.games.includes('ball_fetch')) {
      // "fetch the ball": toss a ball on stage and chase it
      const b = this.host().bounds();
      this.spawnBall(b.xmin + 0.5, 1, 4, 3);
      return;
    }
    this.beh?.doIntent(i);
  }
  setSpeaking(_amplitude: number) { /* TODO */ }
  generatePet(input: { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string },
              onProgress: (p: { stage: string; pct: number }) => void): Promise<PetBundle> {
    return runPipeline(this.opts.apiBase ?? '', input, onProgress, BUDGET[this.quality]);
  }
  on<T extends BusEvent['type']>(t: T, cb: (e: Extract<BusEvent, { type: T }>) => void) { this.bus.on(t, cb); }
}
