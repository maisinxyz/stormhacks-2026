// First-person walking for the Play room.
// Laptop: click to capture the mouse, mouse looks, WASD / arrows walk (Shift runs), Esc lets go.
// Phone: a thumb stick appears under the left thumb, dragging on the right side looks around.
// If the browser refuses the mouse capture, dragging looks around instead.
import * as THREE from 'three';
import type { Engine } from '../../engine';
import { ROOM_SPEC, type RoomCollider } from '../scene';

export const EYE = 1.1;           // metres: a low, toy-world eye height so the pet reads big
const RADIUS = 0.28, WALK = 2.4, RUN = 4.2, FOV = 70, PITCH = 1.25;
const STICK = 46;                 // px of thumb travel for full speed

export class FirstPerson {
  readonly position = new THREE.Vector3(ROOM_SPEC.start.x, EYE, ROOM_SPEC.start.z);
  yaw = 0; pitch = -0.12;
  /** The main button (or a tap in drag mode) went down / up while playing. */
  onPrimary?: (down: boolean) => void;
  /** Fires when the mouse is captured or released, so the HUD can say "click to play". */
  onLock?: (locked: boolean) => void;
  private keys = new Set<string>();
  private dragLook = false;       // pointer lock unavailable: drag to look
  private drag?: { id: number; x: number; y: number; moved: number };
  private stick?: { id: number; x: number; y: number; dx: number; dy: number; el: HTMLElement };
  private look?: { id: number; x: number; y: number };
  private walkT = 0;

  constructor(private engine: Engine, private root: HTMLElement, private colliders: RoomCollider[]) {
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey); window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.onDown, true); window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true); window.addEventListener('pointercancel', this.onUp, true);
    document.addEventListener('mousemove', this.onMouse);
    document.addEventListener('pointerlockchange', this.onLockChange); document.addEventListener('pointerlockerror', this.onLockError);
  }

  get locked() { return document.pointerLockElement === this.root; }
  /** Where the player is looking (unit vector). */
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  release() { if (this.locked) document.exitPointerLock(); }

  update(dt: number) {
    let f = 0, s = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    if (this.stick) { f -= this.stick.dy / STICK; s += this.stick.dx / STICK; }
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * dt;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const p = this.resolve(this.position.x + (-sin * f + cos * s) * speed, this.position.z + (-cos * f - sin * s) * speed);
    this.walkT = len > 0.05 ? this.walkT + dt * Math.min(1, len) : 0;
    this.position.set(p.x, EYE + Math.sin(this.walkT * 9) * 0.022, p.z);
    const c = this.engine.cameraRef;
    c.position.copy(this.position);
    c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (c.fov !== FOV) { c.fov = FOV; c.near = 0.05; c.updateProjectionMatrix(); }
  }
  resize(w: number, h: number) { const c = this.engine.cameraRef; if (Math.abs(c.aspect - w / h) > 1e-4) { c.aspect = w / h; c.updateProjectionMatrix(); } }

  /** Keep a circle of RADIUS inside the walls and outside every obstacle box (slides along them). */
  private resolve(x: number, z: number) {
    const R = ROOM_SPEC.room, mx = R.width / 2 - R.wall / 2 - RADIUS, mz = R.depth / 2 - R.wall / 2 - RADIUS;
    let px = THREE.MathUtils.clamp(x, -mx, mx), pz = THREE.MathUtils.clamp(z, -mz, mz);
    for (const c of this.colliders) {
      const qx = THREE.MathUtils.clamp(px, c.minX, c.maxX), qz = THREE.MathUtils.clamp(pz, c.minZ, c.maxZ);
      const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d > 1e-5) { px += dx / d * (RADIUS - d); pz += dz / d * (RADIUS - d); continue; }
      // centre is inside the box: leave by the nearest side
      const sides = [px - c.minX, c.maxX - px, pz - c.minZ, c.maxZ - pz], i = sides.indexOf(Math.min(...sides));
      if (i === 0) px = c.minX - RADIUS; else if (i === 1) px = c.maxX + RADIUS; else if (i === 2) pz = c.minZ - RADIUS; else pz = c.maxZ + RADIUS;
    }
    return { x: THREE.MathUtils.clamp(px, -mx, mx), z: THREE.MathUtils.clamp(pz, -mz, mz) };
  }

  private turn(dx: number, dy: number, gain: number) {
    this.yaw -= dx * gain;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * gain, -PITCH, PITCH);
  }
  private onUi(e: Event) { return !!(e.target as HTMLElement | null)?.closest?.('button, [data-ui], input, a'); }

  private onKey = (e: KeyboardEvent) => { if (e.type === 'keydown') this.keys.add(e.code); else this.keys.delete(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); };
  private onBlur = () => this.keys.clear();
  private onMouse = (e: MouseEvent) => { if (this.locked) this.turn(e.movementX, e.movementY, 0.0022); };
  private onLockChange = () => this.onLock?.(this.locked);
  private onLockError = () => { this.dragLook = true; };

  private onDown = (e: PointerEvent) => {
    if (this.onUi(e)) return;
    if (e.pointerType === 'touch') {
      if (e.clientX < innerWidth * 0.45 && !this.stick) {
        const el = document.createElement('div');
        el.className = 'room-stick'; el.innerHTML = '<i></i>';
        el.style.left = `${e.clientX}px`; el.style.top = `${e.clientY}px`;
        this.root.appendChild(el);
        this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, el };
      } else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    if (this.locked) { this.onPrimary?.(true); return; }
    if (this.dragLook || !this.root.requestPointerLock) { this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; return; }
    try { void Promise.resolve(this.root.requestPointerLock()).catch(() => { this.dragLook = true; }); } catch { this.dragLook = true; }
  };
  private onMove = (e: PointerEvent) => {
    const s = this.stick, l = this.look, d = this.drag;
    if (s && e.pointerId === s.id) {
      const dx = e.clientX - s.x, dy = e.clientY - s.y, n = Math.max(1, Math.hypot(dx, dy) / STICK);
      s.dx = dx / n; s.dy = dy / n;
      (s.el.firstElementChild as HTMLElement).style.transform = `translate(${s.dx}px, ${s.dy}px)`;
    } else if (l && e.pointerId === l.id) { this.turn(e.clientX - l.x, e.clientY - l.y, 0.0052); l.x = e.clientX; l.y = e.clientY; }
    else if (d && e.pointerId === d.id) { const dx = e.clientX - d.x, dy = e.clientY - d.y; d.moved += Math.hypot(dx, dy); this.turn(dx, dy, 0.0045); d.x = e.clientX; d.y = e.clientY; }
  };
  private onUp = (e: PointerEvent) => {
    if (this.stick?.id === e.pointerId) { this.stick.el.remove(); this.stick = undefined; }
    if (this.look?.id === e.pointerId) this.look = undefined;
    if (this.drag?.id === e.pointerId) { if (this.drag.moved < 6) { this.onPrimary?.(true); this.onPrimary?.(false); } this.drag = undefined; return; } // a click without a drag uses the item
    if (e.pointerType !== 'touch' && e.button === 0 && this.locked) this.onPrimary?.(false);
  };

  dispose() {
    this.release(); this.stick?.el.remove();
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerdown', this.onDown, true); window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true); window.removeEventListener('pointercancel', this.onUp, true);
    document.removeEventListener('mousemove', this.onMouse);
    document.removeEventListener('pointerlockchange', this.onLockChange); document.removeEventListener('pointerlockerror', this.onLockError);
  }
}
