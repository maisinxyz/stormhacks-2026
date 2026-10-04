import * as THREE from 'three';
import type { Engine } from '../engine';

export class RoomOrbit {
  private yaw = 0; private pitch = .58; private distance = 4.65; private target = new THREE.Vector3(0, .45, 0); private pointers = new Map<number, { x: number; y: number }>(); private lastTap = 0; private easing = false;
  constructor(private engine: Engine, private canvas: HTMLCanvasElement) { window.addEventListener('pointerdown', this.down, true); window.addEventListener('pointermove', this.move, true); window.addEventListener('pointerup', this.up, true); window.addEventListener('pointercancel', this.up, true); window.addEventListener('wheel', this.wheel, { passive: false }); }
  private down = (e: PointerEvent) => { const pet = this.engine.hitTest(e.clientX, e.clientY); if (!pet && !this.engine.claimGesture(e.pointerId)) { return; } if (pet) { const now = performance.now(); if (now - this.lastTap < 320) this.focus(); this.lastTap = now; return; } this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.easing = false; };
  private move = (e: PointerEvent) => { const p = this.pointers.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; this.yaw -= dx * .008; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * .006, .14, 1.2); };
  private up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.engine.releaseGesture(e.pointerId); };
  private wheel = (e: WheelEvent) => { e.preventDefault(); this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * .004, 2.8, 6.2); };
  focus() { this.target.set(0, .42, 0); this.distance = 3.5; this.easing = true; }
  update(dt: number) { if (this.easing) { this.distance += (3.5 - this.distance) * Math.min(1, dt * 8); if (Math.abs(this.distance - 3.5) < .01) this.easing = false; } const c = this.engine.cameraRef; const y = this.target.y + Math.sin(this.pitch) * this.distance; const r = Math.cos(this.pitch) * this.distance; c.position.set(this.target.x + Math.sin(this.yaw) * r, y, this.target.z + Math.cos(this.yaw) * r); c.lookAt(this.target); c.fov = 50; c.updateProjectionMatrix(); }
  resize(w: number, h: number) { this.engine.cameraRef.aspect = w / h; this.engine.cameraRef.updateProjectionMatrix(); }
  dispose() { window.removeEventListener('pointerdown', this.down, true); window.removeEventListener('pointermove', this.move, true); window.removeEventListener('pointerup', this.up, true); window.removeEventListener('pointercancel', this.up, true); window.removeEventListener('wheel', this.wheel); for (const id of this.pointers.keys()) this.engine.releaseGesture(id); this.pointers.clear(); }
}
