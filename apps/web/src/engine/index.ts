import * as THREE from 'three';
import type { ActionStep, BusEvent, LocalIntent, Mode, Mood, PetBundle, PetEngine, Platform, RunEvent, Species } from '@fetch/contracts';
import { Bus } from './bus';
import { generatePet as runPipeline } from './pipeline/generate';
import { Behavior, type BehaviorHost, type FurnitureSpot, type PerformStep } from './behavior';
import { Interactions } from './interactions';
import { Needs, type Stats } from './needs';
import { BALL_R, Toys } from './toys';
import { PeekScene } from './peek';
import { Skeleton, type Bone } from './skeleton';
import { Props, type Prop } from './props';
import { PACKS, type FeedItem, type SpeciesPack } from './species';
import { MAX_BONES, SplatMesh } from './splatRenderer';
import { SdfPet, type PlushTraits } from './sdf/sdfPet';
import type { RoomCollider } from '../play/scene';


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
  private view: 'desk' | 'room' | 'camera' = 'desk';
  private externalCamera = false;
  private groundPlane = 0;
  private paws: { mesh: THREE.Mesh; bone: number; tip: THREE.Vector3 }[] = []; // small dark decal under each foot (contact cue)
  private shadowOpacity = 1;
  private petFootprint = new THREE.Vector2(1, 1);
  /** Rest-pose body footprint (x width, y = z length) of the loaded pet, unscaled. */
  get footprint() { return this.petFootprint; }
  /** Turn the idle pose toward +x (1) or -x (-1); the walk cycle sets this on its own while travelling. */
  facePet(sign: 1 | -1) { this.beh?.face(sign); }
  private shadowSize = new THREE.Vector2(1, 1); // body footprint (x width, z length) relative to the 1.2 m decal
  private petScale = 1;
  private overlay?: THREE.Scene;
  private claimedGestures = new Set<number>();
  private furnitureSpots: FurnitureSpot[] = [];
  private roomColliders: RoomCollider[] = [];
  private splat?: SplatMesh | SdfPet; // the pet's renderer: Gaussian splats, or the SDF plush dog
  private mode: Mode = 'work';
  private platforms: Platform[] = [];
  onFrame?: (t: number, frame?: XRFrame) => void;

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
      const ball = this.hitBall(e.clientX, e.clientY), pet = this.hitTest(e.clientX, e.clientY);
      canvas.style.pointerEvents = pet || ball ? 'auto' : 'none';
      canvas.style.cursor = ball ? 'grab' : pet ? 'pointer' : 'default';
    });
    window.addEventListener('pointerdown', e => { if (this.hitBall(e.clientX, e.clientY)) canvas.style.cursor = 'grabbing'; }, true);
    window.addEventListener('pointerup', () => { canvas.style.cursor = 'default'; }, true);
    let prev = 0;
    const loop = (t: number, frame?: XRFrame) => {
      const dt = t / 1000 - prev; prev = t / 1000;
      this.watchFps(dt);
      this.resize();
      this.onFrame?.(t / 1000, frame);
      this.toys?.step(Math.min(dt, 0.1));
      this.inter?.update(Math.min(dt, 0.1), t);
      this.constrainBallToFrame();
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
    this.renderer.setAnimationLoop(loop); // window rAF normally, the XR session's rAF while presenting
    this.bus.emit({ type: 'ENGINE_READY' });
  }

  async loadPet(b: PetBundle) {
    // A plush bundle carries traits, not files: the SDF renderer builds its own body and rig from them.
    const sdf = b.plush ? new SdfPet(b.plush as unknown as PlushTraits) : undefined;
    const [splat, weights, rig] = sdf ? [undefined, undefined, { bones: sdf.bones }] : await Promise.all([
      fetch(b.splatUrl).then(r => r.arrayBuffer()),
      fetch(b.weightsUrl).then(r => r.arrayBuffer()),
      fetch(b.rigUrl).then(r => r.json()),
    ]);
    if (rig.bones.length > MAX_BONES) throw new Error(`rig has ${rig.bones.length} bones, max ${MAX_BONES}`);
    if (this.splat) this.scene.remove(this.splat.mesh);
    this.sk = new Skeleton(rig.bones);
    this.peek?.dispose();
    this.peek = splat && weights && this.peekCanvas ? new PeekScene(this.peekCanvas, PACKS[b.species], splat, weights, rig.bones) : undefined; // ponytail: no edge-peek for plush pets (Desk errands only)
    this.splat = sdf ?? new SplatMesh(splat!, weights!);
    this.splat.setBudget(BUDGET[this.quality]);
    this.splat.uniforms.uTint.value.copy(this.tint);
    this.scene.add(this.splat.mesh);
    this.pack = PACKS[b.species];
    this.needs = new Needs(b.stats, s => this.statsCb?.(s));
    this.beh = new Behavior(this.pack, this.host(), this.needs);
    this.beh.setMode(this.mode);
    this.beh.setAutonomous(this.autonomous);
    for (const p of this.paws) this.scene.remove(p.mesh);
    this.paws = this.bones.flatMap((b, bone) => {
      // the foot is the tip of the last bone in each leg chain (real pets have a lower-leg bone, placeholders do not)
      if (!b.name.startsWith('leg') || this.bones.some(o => o.parent === bone) || !this.shadow) return [];
      const mesh = new THREE.Mesh(this.shadow.geometry, (this.shadow.material as THREE.MeshBasicMaterial).clone());
      mesh.renderOrder = -1;
      this.scene.add(mesh);
      return [{ mesh, bone, tip: new THREE.Vector3(...b.tail) }];
    });
    this.petFootprint.copy(this.splat.footprint());
    this.shadowSize.copy(this.petFootprint).multiplyScalar(1.25 / 1.2); // decal is a 1.2 m quad; a little larger than the body
    if (this.listeningPending) this.beh.setListening(true);
  }

  private tickBehavior(dt: number) {
    const before = this.beh!.snapshot();
    const o = this.beh!.update(dt), m = this.splat!.mesh;
    this.constrainPetToFrame(before);
    if (this.view === 'room') {
      const safe = this.beh!.snapshot();
      o.x = safe.x; o.z = safe.z;
    }
    if (this.view === 'camera') { const fixed = this.beh!.snapshot(); o.x = fixed.x; o.z = fixed.z; }
    for (const b of this.bones) this.setBoneEuler(b.name, 0, 0, 0);
    for (const [n, e] of Object.entries(o.pose.bones)) this.setBoneEuler(n, e[0], e[1], e[2]);
    // behavior y (hops, carry lift) is in metres; the clip's own y offset is authored for a 1-unit pet, so scale it
    const poseY = o.pose.y ?? 0;
    m.position.set(o.x, Math.max(this.groundPlane, o.y - poseY + poseY * this.petScale + this.groundPlane), o.z); // groundPlane = real floor height under WebXR
    m.rotation.y = o.yaw;
    m.scale.setScalar(this.petScale);
    if (this.shadow) { this.shadow.position.set(o.x, this.groundPlane + 0.002, o.z); this.shadow.rotation.y = o.yaw; this.shadow.scale.set(this.shadowSize.x * this.petScale, 1, this.shadowSize.y * this.petScale); this.shadow.visible = m.visible; }
    // contact darkening: follows each foot along the floor and fades as the foot lifts (walk cycle, hops, carry)
    m.updateMatrix();
    for (const p of this.paws) {
      const w = this.boneWorld[p.bone];
      if (!w) continue;
      const v = p.tip.clone().applyMatrix4(w).applyMatrix4(m.matrix);
      const lift = (v.y - this.groundPlane) / this.petScale;
      p.mesh.position.set(v.x, this.groundPlane + 0.003, v.z);
      p.mesh.scale.setScalar(0.3 * this.petScale);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = this.shadowOpacity * THREE.MathUtils.clamp(1 - lift / 0.15, 0, 1);
      p.mesh.visible = m.visible;
    }
    this.applyLook(dt, o.pose.bones.head);
  }

  /** Clamp the actual animated body every frame, not just its requested target. */
  private constrainPetToFrame(previous?: { x: number; z: number }) {
    if (!this.beh) return;
    if (this.view === 'room') {
      const state = this.beh.snapshot();
      const safe = previous ? this.sweepRoomPosition(previous.x, previous.z, state.x, state.z) : this.resolveRoomPosition(state.x, state.z);
      if (Math.abs(safe.x - state.x) > .0001 || Math.abs(safe.z - state.z) > .0001) this.beh.constrainPosition(safe.x, safe.z);
      return;
    }
    if (this.view !== 'camera') return;
    const state = this.beh.snapshot();
    const p = new THREE.Vector3(state.x, this.groundPlane, state.z).project(this.camera);
    const x = THREE.MathUtils.clamp(p.x, -.72, .72), y = THREE.MathUtils.clamp(p.y, -.78, .12);
    if (Math.abs(x - p.x) < .001 && Math.abs(y - p.y) < .001) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.groundPlane), new THREE.Vector3());
    if (hit) this.beh.constrainPosition(hit.x, hit.z);
  }

  private resolveRoomPosition(x: number, z: number) {
    const radius = this.roomRadius();
    let px = THREE.MathUtils.clamp(x, -4.75 + radius, 4.75 - radius);
    let pz = THREE.MathUtils.clamp(z, -3.45 + radius, 3.45 - radius);
    for (const c of this.roomColliders) {
      const qx = THREE.MathUtils.clamp(px, c.minX, c.maxX), qz = THREE.MathUtils.clamp(pz, c.minZ, c.maxZ);
      const dx = px - qx, dz = pz - qz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-5) { px += dx / d * (radius - d); pz += dz / d * (radius - d); }
      else {
        const left = Math.abs(px - c.minX), right = Math.abs(c.maxX - px), top = Math.abs(pz - c.minZ), bottom = Math.abs(c.maxZ - pz);
        const min = Math.min(left, right, top, bottom);
        if (min === left) px = c.minX - radius; else if (min === right) px = c.maxX + radius;
        else if (min === top) pz = c.minZ - radius; else pz = c.maxZ + radius;
      }
    }
    return { x: THREE.MathUtils.clamp(px, -4.75 + radius, 4.75 - radius), z: THREE.MathUtils.clamp(pz, -3.45 + radius, 3.45 - radius) };
  }

  private roomRadius() { return Math.max(.28, Math.max(this.petFootprint.x, this.petFootprint.y) * this.petScale * .48); }

  private roomPositionFree(x: number, z: number) {
    const radius = this.roomRadius();
    if (x < -4.75 + radius || x > 4.75 - radius || z < -3.45 + radius || z > 3.45 - radius) return false;
    return this.roomColliders.every(c => {
      const qx = THREE.MathUtils.clamp(x, c.minX, c.maxX), qz = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
      return Math.hypot(x - qx, z - qz) >= radius;
    });
  }

  /** Move in short steps, testing each axis independently so blocked motion slides along an obstacle. */
  private sweepRoomPosition(fromX: number, fromZ: number, toX: number, toZ: number) {
    let x = this.resolveRoomPosition(fromX, fromZ).x, z = this.resolveRoomPosition(fromX, fromZ).z;
    const distance = Math.hypot(toX - x, toZ - z), steps = Math.max(1, Math.ceil(distance / .045));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, wantedX = x + (toX - x) * t, wantedZ = z + (toZ - z) * t;
      if (this.roomPositionFree(wantedX, z)) x = wantedX;
      if (this.roomPositionFree(x, wantedZ)) z = wantedZ;
    }
    return { x, z };
  }

  /** Screen-space safety rails for the toy. At an edge, the velocity is reflected so
   * the ball remains physical instead of being silently teleported away. */
  private constrainBallToFrame() {
    if (!this.toys?.present || !this.renderer) return;
    const b = this.toys.pos, p = new THREE.Vector3(b.x, b.y, .15).project(this.camera);
    const x = THREE.MathUtils.clamp(p.x, -.9, .9), y = THREE.MathUtils.clamp(p.y, -.86, .82);
    if (Math.abs(x - p.x) < .001 && Math.abs(y - p.y) < .001) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -.15), new THREE.Vector3());
    if (hit) this.toys.constrain(hit.x, hit.y, Math.abs(x - p.x) > .001, Math.abs(y - p.y) > .001);
  }

  // ---- look-at layer (play.md B.6): head turns toward a world target on top of whatever clip is playing ----
  private look = { target: null as THREE.Vector3 | null, yaw: 0, pitch: 0 };
  /** World point the head should turn toward (e.g. the camera), or null to release. Clamped and smoothed. */
  setLookAt(target: THREE.Vector3 | null) { this.look.target = target; }
  private applyLook(dt: number, headPose?: [number, number, number]) {
    const L = this.look, head = this.bones.find(b => b.name === 'head'), m = this.splat!.mesh;
    let ty = 0, tp = 0;
    const st = this.beh!.state;
    if (L.target && head && st !== 'sleep' && st !== 'exit' && st !== 'working') {
      m.updateMatrix();
      const d = L.target.clone().applyMatrix4(m.matrix.clone().invert()).sub(new THREE.Vector3(...head.head)); // target in pet space, from the neck
      ty = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -1.22, 1.22);                     // +-70deg
      tp = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.61, 0.61);   // +-35deg (x<0 raises the nose)
    }
    const k = Math.min(1, dt * 6);
    L.yaw += (ty - L.yaw) * k; L.pitch += (tp - L.pitch) * k;
    if (!head || (Math.abs(L.yaw) < 1e-3 && Math.abs(L.pitch) < 1e-3)) return;
    const e = headPose ?? [0, 0, 0];
    this.setBoneEuler('head', e[0] + L.pitch, e[1] + L.yaw, e[2]);
  }

  /** Splat colour multiplier (ambient match, play.md B.8). (1,1,1) = off. */
  setTint(r: number, g: number, b: number) { this.splat?.uniforms.uTint.value.set(r, g, b); this.tint.set(r, g, b); }
  private tint = new THREE.Vector3(1, 1, 1);
  setShadowOpacity(o: number) { this.shadowOpacity = o; if (this.shadow) (this.shadow.material as THREE.MeshBasicMaterial).opacity = o; }
  /** Floor height of the ground plane the pet stands on (WebXR hit-test supplies the real floor). */
  setGroundHeight(y: number) { this.setGroundPlane(y); }
  /** Feed the species' own food (action chip / voice "treat"). */
  feed() {
    const item = this.pack?.foods[0];
    if (!item || !this.feedItem(item)) return false;
    this.bus.emit({ type: 'FEED', item });
    this.beh?.react('feed');
    const p = this.petPosition;
    // Keep the dimensional biscuit clearly above the dog's head.
    p.y += 1.05 * this.petScale;
    this.props?.setWorld({ kind: 'preset', name: 'bone' }, p);
    this.props?.burst('sparkle', p.clone().add(new THREE.Vector3(0, .08, 0)), 14);
    window.setTimeout(() => this.props?.setWorld(undefined), 1400);
    return true;
  }
  /** Render one frame right now (capture reads the canvas back in the same task, play.md B.9). */
  renderNow() { this.renderer.render(this.scene, this.camera); }
  /** The WebGL renderer, for WebXR session setup (play.md B.5). */
  get webgl() { return this.renderer; }

  // ---- Camera-view seams (play.md B): the pet walks in world metres on the ground plane (Person A's model) ----
  setPetScale(s: number) { this.petScale = s; }
  /** A little burst above the pet: hearts when it is petted, sparkles when it appears (camera view flourish). */
  flourish(kind: 'heart' | 'sparkle') { const p = this.petPosition; p.y += 1.05 * this.petScale; this.props?.burst(kind, p, kind === 'heart' ? 4 : 14); }
  /** Scripted behaviour (Play camera voice commands): clips, walks and callbacks in order. */
  perform(steps: PerformStep[]) { this.walkTo = undefined; this.beh?.perform(steps); }
  /** Turn the pet's body toward a floor point. */
  faceToward(x: number, z: number) { this.beh?.faceToward(x, z); }
  private autonomous = true;
  /** false = the pet only moves on a command (camera view). */
  setAutonomous(on: boolean) { this.autonomous = on; this.beh?.setAutonomous(on); }
  get scaleNow() { return this.petScale; }
  private walkTo?: { x: number; z: number };
  /** Put the pet at a ground point (metres). walk=true walks there with the walk/run cycle; false teleports. */
  placePet(x: number, z: number, walk = true) {
    if (!walk) { this.walkTo = undefined; this.beh?.applySnapshot({ x, z, y: 0 }); return; }
    this.walkTo = { x, z };
    this.beh?.pointTo(x, z);
  }
  /** Pick the pet up and carry it (finger drag); call with drop=true on release and it walks off the last bit and settles. */
  carryPet(x: number, z: number, drop = false) {
    const beh = this.beh;
    if (!beh || this.view !== 'room') { this.walkTo = drop ? { x, z } : undefined; beh?.dragTo(x, z, drop); return; }
    const from = beh.snapshot();
    const safe = this.sweepRoomPosition(from.x, from.z, x, z);
    const px = safe.x, pz = safe.z;
    this.walkTo = drop ? { x: px, z: pz } : undefined;
    beh.dragTo(px, pz, drop);
  }
  /** True while the pet is on its way to a placePet target. */
  get travelling() {
    const w = this.walkTo, p = this.beh;
    if (!w || !p) return false;
    if (Math.hypot(p.x - w.x, p.z - w.z) < 0.08) { this.walkTo = undefined; return false; }
    return true;
  }
  get petPosition() { return this.splat?.mesh.position.clone() ?? new THREE.Vector3(); }
  /** Screen px -> point on the active plane (desk: z=0 stage; room/camera: ground). */
  groundPoint(px: number, py: number) { return this.toWorld(px, py); }

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
    if (this.view === 'room' || this.view === 'camera') return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.groundPlane), new THREE.Vector3()) ?? undefined;
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3()) ?? undefined;
  }

  private host(): BehaviorHost {
    return {
      bounds: () => {
        if (this.view === 'room' || this.view === 'camera') return { xmin: -4.75, xmax: 4.75, zmin: -3.45, zmax: 3.45 };
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
      burst: (k, x, y, z = 0.1, n = 10) => this.props?.burst(k, new THREE.Vector3(x, y, z), n),
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
      // camera view: a tap is affection, not a poke (look at the user + wag), see play.md B.7
      react: (k: 'pet' | 'poke' | 'feed') => this.beh?.react(k === 'poke' && this.view === 'camera' ? 'tap' : k),
      petted: (i: number, dt: number) => this.needs?.petted(i, dt),
      feed: (item: FeedItem) => this.feedItem(item),
      holdBall: (x: number, y: number) => this.toys?.hold(x, y),
      releaseBall: (vx: number, vy: number) => { this.toys?.release(vx, vy); this.beh?.fetchBall(); },
      point: (x: number, z?: number) => this.beh?.pointTo(x, this.view === 'room' || this.view === 'camera' ? z : undefined),
      dragPet: (x: number, z: number, drop: boolean) => this.beh?.dragTo(x, z, drop),
      petPosition: () => { const p = this.beh?.snapshot(); return { x: p?.x ?? 0, z: p?.z ?? 0 }; },
      cursor: (x: number, y: number) => { this.cursorAt = { x, y, t: performance.now() }; this.beh?.setCursor(x, y); },
      approval: () => ({ pending: this.approvalPending, actionId: this.approvalActionId }),
      setRing: (p: number) => this.setRing(p),
      mode: () => this.mode,
      isGestureClaimed: (pointerId: number) => this.claimedGestures.has(pointerId),
      furnitureSpots: () => this.furnitureSpots,
    };
  }

  private hitBall(x: number, y: number) {
    if (!this.toys?.hittable) return false;
    const r = this.renderer.domElement.getBoundingClientRect(), b = this.toys.pos;
    const screen = new THREE.Vector3(b.x, b.y, .15).project(this.camera);
    const sx = r.left + (screen.x + 1) * .5 * r.width, sy = r.top + (1 - screen.y) * .5 * r.height;
    return Math.hypot(x - sx, y - sy) < Math.max(28, Math.min(r.width, r.height) * .055);
  }

  /** Species food check; wrong food is ignored. Resets hunger. */
  feedItem(item: FeedItem) {
    if (!this.pack?.foods.includes(item)) return false;
    this.needs?.fed();
    return true;
  }

  /** F2 Toy Box: put the ball on stage (optionally with a toss). */
  spawnBall(x = -1, y = 1.2, vx = 0, vy = 0) { this.toys?.spawn(x, y); if (vx || vy) { this.toys?.release(vx, vy); this.beh?.fetchBall(); } }
  /** Spawn the ball at the visual middle-bottom of the current screen. */
  spawnBallAtScreen() { this.spawnBall(0, .42); }
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
  react(kind: 'pet' | 'poke' | 'feed' | 'tap') { this.beh?.react(kind); }
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
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.55, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)'); // dark core: reads as contact, not a haze
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.position.y = 0.002;
    m.renderOrder = -1;
    return m;
  }

  private resize() {
    if (this.renderer.xr.isPresenting) return;
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * this.pr) || c.height !== Math.round(h * this.pr)) {
      this.renderer.setPixelRatio(this.pr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() { this.renderer.setAnimationLoop(null); this.renderer.dispose(); }

  // --- PetEngine surface; F1 slice 0-5h implements loading/skinning only. TODOs land in later slices. ---
  setMode(mode: Mode) { this.mode = mode; this.beh?.setMode(mode); }
  setView(v: 'desk' | 'room' | 'camera', opts?: { petScale?: number }) { this.view = v; this.petScale = opts?.petScale ?? (v === 'room' ? 0.55 : v === 'camera' ? 0.45 : 1); this.setGroundPlane(v === 'desk' ? 0 : this.groundPlane); }
  setExternalCamera(on: boolean) { this.externalCamera = on; }
  get cameraRef() { return this.camera; }
  setOverlayScene(scene: THREE.Scene | null) { if (this.overlay) this.scene.remove(this.overlay); this.overlay = scene ?? undefined; if (this.overlay) { this.overlay.renderOrder = -10; this.scene.add(this.overlay); } }
  setGroundPlane(y: number) { this.groundPlane = y; }
  setFurnitureSpots(spots: FurnitureSpot[]) { this.furnitureSpots = spots; }
  setRoomColliders(colliders: RoomCollider[]) { this.roomColliders = colliders; }
  setSplatDepthTest(on: boolean) { this.splat?.setDepthTest(on); }
  claimGesture(pointerId: number) { if (this.claimedGestures.has(pointerId)) return false; this.claimedGestures.add(pointerId); return true; }
  releaseGesture(pointerId: number) { this.claimedGestures.delete(pointerId); }
  getPetState() { return this.beh?.snapshot() ?? { x: 0, z: 0, heading: 0, y: 0, state: 'idle' as const }; }
  applyPetState(s: { x: number; z: number; heading?: number; y?: number }) { this.beh?.applySnapshot(s); }
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
