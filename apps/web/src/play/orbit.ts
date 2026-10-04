import * as THREE from 'three';
import type { Engine } from '../engine';
import { ROOM_SPEC } from './scene';

export class RoomOrbit {
  private yaw = 0; private pitch = .5; private distance = 3.45; private target = new THREE.Vector3(0, 1.18, 0);
  constructor(private engine: Engine, _canvas: HTMLCanvasElement) {}
  focus() { this.target.set(0, 1.18, 0); }
  update(_dt: number) { const c = this.engine.cameraRef, room = ROOM_SPEC.room, clearance = ROOM_SPEC.clearance; const y = THREE.MathUtils.clamp(1.18 + Math.sin(this.pitch) * this.distance, clearance.cameraFloor, room.height - clearance.cameraCeiling); const r = Math.cos(this.pitch) * this.distance; const x = THREE.MathUtils.clamp(Math.sin(this.yaw) * r, -room.width / 2 + clearance.cameraWall, room.width / 2 - clearance.cameraWall); const z = THREE.MathUtils.clamp(Math.cos(this.yaw) * r, -room.depth / 2 + clearance.cameraWall, room.depth / 2 - clearance.cameraWall); c.position.set(x, y, z); c.lookAt(this.target); c.fov = 52; c.updateProjectionMatrix(); }
  resize(w: number, h: number) { this.engine.cameraRef.aspect = w / h; this.engine.cameraRef.updateProjectionMatrix(); }
  dispose() {}
}
