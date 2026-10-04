import * as THREE from 'three';
import type { Engine } from '../engine';
import { ROOM_SPEC } from './scene';

export class RoomOrbit {
  private yaw = 0; private pitch = .5; private distance = 3.45;
  private target = new THREE.Vector3(0, 1.18, 0);
  private dragging = false; private pan = false; private last = { x: 0, y: 0 };
  constructor(private engine: Engine, private canvas: HTMLCanvasElement) {
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
    window.addEventListener('wheel', this.onWheel, { passive: false });
  }
  focus() { this.target.set(0, 1.18, 0); this.yaw = 0; this.pitch = .5; this.distance = 3.45; }
  update(_dt: number) {
    const c = this.engine.cameraRef, room = ROOM_SPEC.room, clearance = ROOM_SPEC.clearance;
    const r = Math.cos(this.pitch) * this.distance;
    const x = this.target.x + Math.sin(this.yaw) * r, z = this.target.z + Math.cos(this.yaw) * r;
    const safeX = THREE.MathUtils.clamp(x, -room.width / 2 + clearance.cameraWall, room.width / 2 - clearance.cameraWall);
    const safeZ = THREE.MathUtils.clamp(z, -room.depth / 2 + clearance.cameraWall, room.depth / 2 - clearance.cameraWall);
    const y = THREE.MathUtils.clamp(this.target.y + Math.sin(this.pitch) * this.distance, clearance.cameraFloor, room.height - clearance.cameraCeiling);
    c.position.set(safeX, y, safeZ); c.lookAt(this.target); c.fov = 52; c.updateProjectionMatrix();
  }
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement)?.closest?.('.room-ui')) return;
    if (this.engine.hitTest(e.clientX, e.clientY)) return;
    this.dragging = true; this.pan = e.shiftKey || e.altKey; this.last = { x: e.clientX, y: e.clientY };
    this.canvas.style.cursor = this.pan ? 'move' : 'grabbing';
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y; this.last = { x: e.clientX, y: e.clientY };
    if (this.pan) {
      this.target.x = THREE.MathUtils.clamp(this.target.x - dx * .006, -2.2, 2.2);
      this.target.z = THREE.MathUtils.clamp(this.target.z + dy * .006, -1.35, 1.35);
    } else { this.yaw -= dx * .008; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * .006, -.72, .9); }
    e.preventDefault();
  };
  private onUp = () => { this.dragging = false; this.canvas.style.cursor = 'grab'; };
  private onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement)?.closest?.('.room-ui')) return;
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * .001), 2.35, 5.35); e.preventDefault();
  };
  resize(w: number, h: number) { this.engine.cameraRef.aspect = w / h; this.engine.cameraRef.updateProjectionMatrix(); }
  dispose() {
    window.removeEventListener('pointerdown', this.onDown, true); window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true); window.removeEventListener('pointercancel', this.onUp, true); window.removeEventListener('wheel', this.onWheel);
  }
}
