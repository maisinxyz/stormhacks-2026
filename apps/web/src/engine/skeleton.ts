import * as THREE from 'three';

export interface Bone { name: string; parent: number; head: [number, number, number]; tail: [number, number, number] }

/** Posable rig: local rotation per bone about its rest-pose head; parents listed before children. */
export class Skeleton {
  readonly pose: THREE.Quaternion[];
  world: THREE.Matrix4[] = [];
  private eul = new THREE.Euler();

  constructor(readonly bones: Bone[]) { this.pose = bones.map(() => new THREE.Quaternion()); }

  setEuler(name: string, x: number, y: number, z: number) {
    const i = this.bones.findIndex(b => b.name === name);
    if (i >= 0) this.pose[i].setFromEuler(this.eul.set(x, y, z));
  }

  reset() { this.pose.forEach(q => q.identity()); }

  /** World skin matrix per bone: M_b = M_parent * T(h) * R * T(-h). Copies into `out` (shader uniforms) if given. */
  update(out?: THREE.Matrix4[]) {
    const world: THREE.Matrix4[] = [];
    this.bones.forEach((b, i) => {
      const h = new THREE.Vector3(...b.head);
      const m = new THREE.Matrix4().makeTranslation(h.x, h.y, h.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(this.pose[i]))
        .multiply(new THREE.Matrix4().makeTranslation(-h.x, -h.y, -h.z));
      world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(m) : m;
      out?.[i].copy(world[i]);
    });
    this.world = world;
  }
}
