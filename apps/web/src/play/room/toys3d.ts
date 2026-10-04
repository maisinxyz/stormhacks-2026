// Throwable toys for the first-person room: a bouncy ball and a gliding frisbee, plus the fetch game around them.
// Hand-rolled ballistics (gravity, bounce off the floor, walls, ceiling and furniture boxes). One toy is out at a time:
// it flies, comes to rest, the pet runs to it, carries it to the player, drops it, and it returns to the hand.
// ponytail: furniture boxes are all treated as 0.8 m tall, and the pet walks straight at the toy (the engine slides it
// round obstacles). A 12 s limit returns the toy if the pet cannot reach it. Real 3D physics / path-finding if this is not enough.
import * as THREE from 'three';
import type { Engine } from '../../engine';
import { ROOM_SPEC, type RoomCollider } from '../scene';

export type ToyKind = 'ball' | 'frisbee';
type Phase = 'held' | 'flying' | 'fetching' | 'carried' | 'dropped';

const R = { ball: 0.085, frisbee: 0.1 };       // collision radius
const BOX_H = 0.8, FETCH_LIMIT = 12, RETURN_SECS = 0.8;
const CHARGE_MS = 900;
const FLOOR_X = 4.0, FLOOR_Z = 2.7;   // a resting toy is moved inside this area: the pet's body keeps it this far from the walls
const GRAB = 0.9, GIVE = 1.8;         // the pet picks the toy up from this close, and hands it over this close to the player

export class Toys3D {
  /** A fetch was completed (the pet brought the toy back). */
  onFetched?: (kind: ToyKind) => void;
  /** Sound / feedback hooks. */
  onThrow?: (kind: ToyKind) => void; onBounce?: (speed: number) => void;
  private mesh: Record<ToyKind, THREE.Object3D>;
  private food: THREE.Object3D;
  private kind: ToyKind = 'ball';
  private phase: Phase = 'held';
  private vel = new THREE.Vector3(); private restT = 0; private t = 0;
  private next?: 'pickup' | 'drop';
  private grounded = false;
  private chargeAt = 0;

  constructor(private engine: Engine, scene: THREE.Scene, private colliders: RoomCollider[], private player: () => THREE.Vector3) {
    const ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 212, 212, 212, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
    const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    const flat = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
    const ball = new THREE.Group();
    ball.add(new THREE.Mesh(flat(new THREE.IcosahedronGeometry(0.085, 1)), toon(0xd7ee4a)));
    const seam = new THREE.Mesh(flat(new THREE.TorusGeometry(0.087, 0.008, 4, 10)), toon(0xffffff)); seam.rotation.x = 0.9; ball.add(seam);
    const frisbee = new THREE.Group();
    frisbee.add(new THREE.Mesh(flat(new THREE.CylinderGeometry(0.17, 0.19, 0.03, 10)), toon(0xff5d5d)));
    const hub = new THREE.Mesh(flat(new THREE.CylinderGeometry(0.08, 0.08, 0.034, 8)), toon(0xffffff)); frisbee.add(hub);
    this.mesh = { ball, frisbee };
    // the treat in the player's hand: a little bone
    const food = this.food = new THREE.Group(), boneMat = toon(0xfff1d6);
    const shaft = new THREE.Mesh(flat(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6)), boneMat); shaft.rotation.z = Math.PI / 2; food.add(shaft);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const knob = new THREE.Mesh(flat(new THREE.IcosahedronGeometry(0.034, 0)), boneMat); knob.position.set(sx * 0.085, sy * 0.022, 0); food.add(knob); }
    food.visible = false; scene.add(food);
    for (const m of Object.values(this.mesh)) { m.visible = false; scene.add(m); }
  }

  /** The toy that is out of the hand, if any. */
  get out(): ToyKind | undefined { return this.phase === 'held' ? undefined : this.kind; }
  /** Where the pet should be looking: a toy in the air or on the floor waiting for it. */
  get attention(): THREE.Vector3 | undefined { return this.phase === 'flying' ? this.mesh[this.kind].position : undefined; }
  /** 0..1 while the throw is being charged, else 0. */
  get charge() { return this.chargeAt ? Math.min(1, (performance.now() - this.chargeAt) / CHARGE_MS) : 0; }
  get state() { return { phase: this.phase, kind: this.kind, position: this.mesh[this.kind].position.clone() }; }

  /** Show `kind` in the player's hand (undefined: the hand holds something else). Called every frame with the camera. */
  hold(kind: ToyKind | 'food' | undefined, camera: THREE.Camera) {
    this.food.visible = kind === 'food';
    if (this.food.visible) { this.food.position.set(0.28, -0.24, -0.66).applyMatrix4(camera.matrixWorld); this.food.quaternion.copy(camera.quaternion); this.food.rotateZ(0.5); }
    for (const k of ['ball', 'frisbee'] as const) {
      const m = this.mesh[k];
      if (this.phase !== 'held' && k === this.kind) continue; // it is out in the room
      m.visible = k === kind;
      if (!m.visible) continue;
      const pull = this.charge;
      m.position.set(0.3 + pull * 0.05, -0.24 - pull * 0.03, -0.72 + pull * 0.16).applyMatrix4(camera.matrixWorld);
      m.quaternion.copy(camera.quaternion);
      if (k === 'frisbee') m.rotateX(0.5);
    }
  }

  /** Button down: start charging a throw. Returns false if this toy is not in the hand. */
  press(kind: ToyKind) { if (this.phase !== 'held') return false; this.kind = kind; this.chargeAt = performance.now(); return true; }
  /** Button up: throw along `dir` (a quick click still throws a short way). */
  release(dir: THREE.Vector3) {
    if (!this.chargeAt || this.phase !== 'held') { this.chargeAt = 0; return; }
    const power = 0.35 + 0.65 * this.charge, k = this.kind;
    this.chargeAt = 0;
    const d = dir.clone(); d.y += k === 'ball' ? 0.2 : 0.1; d.normalize();
    this.vel.copy(d).multiplyScalar(k === 'ball' ? 3 + 6.5 * power : 3 + 4.5 * power);
    this.phase = 'flying'; this.t = 0; this.restT = 0;
    this.mesh[k].visible = true;
    this.onThrow?.(k);
  }
  /** Put the toy straight back in the hand (a new command interrupted the fetch, or the room is closing). */
  cancel() { this.phase = 'held'; this.next = undefined; this.chargeAt = 0; }

  update(dt: number) {
    if (this.phase === 'held') return;
    const m = this.mesh[this.kind], e = this.engine;
    this.t += dt;
    if (this.phase === 'flying') {
      const n = Math.max(1, Math.ceil(dt / 0.008));
      for (let i = 0; i < n; i++) this.step(m.position, dt / n);
      if (this.kind === 'ball') { m.rotation.x += this.vel.z * dt * 6; m.rotation.z -= this.vel.x * dt * 6; }
      else { m.rotation.set(0, m.rotation.y + dt * 14, 0); }
      if (this.restT > 0.25 || this.t > 7) this.settle();
    } else if (this.phase === 'carried') {
      const c = e.carryPoint();
      if (c) m.position.copy(c); else { const p = e.petPosition; m.position.set(p.x, 0.3 * e.scaleNow, p.z); }
    }
    // a big pet cannot stand exactly on the toy (or exactly at the player's feet): close enough counts
    const pp = e.petPosition, pl0 = this.player();
    if (this.phase === 'fetching' && Math.hypot(pp.x - m.position.x, pp.z - m.position.z) < GRAB) this.next = 'pickup';
    if (this.phase === 'carried' && this.t > 0.3 && Math.hypot(pp.x - pl0.x, pp.z - pl0.z) < GIVE) this.next = 'drop';
    if (this.next === 'pickup') {
      this.next = undefined; this.phase = 'carried'; this.t = 0;
      const pl = this.player(), p = e.petPosition, d = new THREE.Vector3(p.x - pl.x, 0, p.z - pl.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
      d.setLength(1.4);
      e.perform([{ to: { x: pl.x + d.x, z: pl.z + d.z }, fast: true }, { call: () => { this.next = 'drop'; } }]);
    } else if (this.next === 'drop') {
      this.next = undefined; this.phase = 'dropped'; this.t = 0;
      m.position.y = R[this.kind]; m.rotation.set(0, 0, 0);
      const pl = this.player();
      e.played();
      e.perform([{ call: () => e.faceToward(pl.x, pl.z) }, { call: () => e.flourish('heart') }, { clip: 'wag', secs: 1.4 }]);
      this.onFetched?.(this.kind);
    }
    if (this.phase === 'dropped' && this.t > RETURN_SECS) this.phase = 'held';
    if ((this.phase === 'fetching' || this.phase === 'carried') && this.t > FETCH_LIMIT) this.phase = 'held'; // the pet got distracted or stuck
  }

  /** The toy stopped: make sure the pet can reach the spot, then send it. */
  private settle() {
    const m = this.mesh[this.kind], r = 0.4;
    let x = THREE.MathUtils.clamp(m.position.x, -FLOOR_X, FLOOR_X), z = THREE.MathUtils.clamp(m.position.z, -FLOOR_Z, FLOOR_Z);
    for (const c of this.colliders) { // out of (and a pet's width away from) every furniture box
      if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
      const sides = [x - (c.minX - r), (c.maxX + r) - x, z - (c.minZ - r), (c.maxZ + r) - z], i = sides.indexOf(Math.min(...sides));
      if (i === 0) x = c.minX - r; else if (i === 1) x = c.maxX + r; else if (i === 2) z = c.minZ - r; else z = c.maxZ + r;
    }
    m.position.set(THREE.MathUtils.clamp(x, -FLOOR_X, FLOOR_X), R[this.kind], THREE.MathUtils.clamp(z, -FLOOR_Z, FLOOR_Z));
    m.rotation.set(0, m.rotation.y, 0);
    this.vel.set(0, 0, 0);
    this.phase = 'fetching'; this.t = 0;
    this.engine.perform([{ to: { x: m.position.x, z: m.position.z }, fast: true }, { call: () => { this.next = 'pickup'; } }]);
  }

  private step(p: THREE.Vector3, dt: number) {
    const v = this.vel, k = this.kind, r = R[k], room = ROOM_SPEC.room;
    const flatSpeed = Math.hypot(v.x, v.z);
    if (k === 'frisbee') { v.y -= 9.8 * (1 - Math.min(0.86, flatSpeed / 4.5)) * dt; v.multiplyScalar(1 - 0.3 * dt); } // lift while it is moving fast
    else v.y -= 9.8 * dt;
    p.addScaledVector(v, dt);
    const bounce = k === 'ball' ? 0.58 : 0.2;
    const hit = (speed: number) => { if (speed > 1.2) this.onBounce?.(speed); };
    this.grounded = false;
    if (p.y < r) { // floor
      p.y = r; hit(-v.y); this.grounded = true;
      v.y = -v.y * bounce; if (v.y < 0.6) v.y = 0;
      const grip = k === 'ball' ? 1.6 : 7; v.x *= Math.max(0, 1 - grip * dt * 4); v.z *= Math.max(0, 1 - grip * dt * 4);
    }
    if (p.y > room.height - r) { p.y = room.height - r; v.y = -Math.abs(v.y) * bounce; }
    const mx = room.width / 2 - room.wall / 2 - r, mz = room.depth / 2 - room.wall / 2 - r;
    if (Math.abs(p.x) > mx) { hit(Math.abs(v.x)); p.x = Math.sign(p.x) * mx; v.x = -v.x * bounce; }
    if (Math.abs(p.z) > mz) { hit(Math.abs(v.z)); p.z = Math.sign(p.z) * mz; v.z = -v.z * bounce; }
    if (p.y - r < BOX_H) for (const c of this.colliders) {
      if (p.x < c.minX - r || p.x > c.maxX + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
      const top = BOX_H - (p.y - r), sides = [p.x - (c.minX - r), (c.maxX + r) - p.x, p.z - (c.minZ - r), (c.maxZ + r) - p.z, top], i = sides.indexOf(Math.min(...sides));
      if (i === 4) { p.y = BOX_H + r; hit(-v.y); v.y = Math.abs(v.y) * bounce; if (v.y < 0.6) v.y = 0; v.x *= 0.8; v.z *= 0.8; this.grounded = true; }
      else if (i < 2) { hit(Math.abs(v.x)); p.x = i === 0 ? c.minX - r : c.maxX + r; v.x = -v.x * bounce; }
      else { hit(Math.abs(v.z)); p.z = i === 2 ? c.minZ - r : c.maxZ + r; v.z = -v.z * bounce; }
    }
    this.restT = this.grounded && v.length() < 0.35 ? this.restT + dt : 0;
  }
}
