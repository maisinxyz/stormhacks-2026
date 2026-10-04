import * as THREE from 'three';

/** A bone posed from another bone instead of clips (pipeline/rig.ts): necks, tail tips, knees. */
export interface Follow { bone: string; k: [number, number, number]; abs?: boolean; split?: boolean; only?: 'neg' | 'pos' }
export interface Bone { name: string; parent: number; head: [number, number, number]; tail: [number, number, number]; follow?: Follow }

/** Posable rig: local rotation per bone about its rest-pose head; parents listed before children. */
export class Skeleton {
  readonly pose: THREE.Quaternion[];
  world: THREE.Matrix4[] = [];
  private eul = new THREE.Euler();
  private followers: { i: number; j: number; f: Follow }[];
  /** Poses changed since followers were last derived (update() may run more than once per frame). */
  private dirty = true;

  constructor(readonly bones: Bone[]) {
    this.pose = bones.map(() => new THREE.Quaternion());
    this.followers = bones.flatMap((b, i) => {
      const j = b.follow ? bones.findIndex(o => o.name === b.follow!.bone) : -1;
      return j >= 0 ? [{ i, j, f: b.follow! }] : [];
    });
  }

  setEuler(name: string, x: number, y: number, z: number) {
    const i = this.bones.findIndex(b => b.name === name);
    if (i >= 0) { this.pose[i].setFromEuler(this.eul.set(x, y, z)); this.dirty = true; }
  }

  reset() { this.pose.forEach(q => q.identity()); this.dirty = true; }

  /** Derives follower poses from the clip-driven bones they follow (read before any split is applied). */
  private applyFollowers() {
    if (!this.followers.length || !this.dirty) return;
    this.dirty = false;
    const src = this.followers.map(({ j }) => new THREE.Euler().setFromQuaternion(this.pose[j]));
    this.followers.forEach(({ i, f }, n) => {
      const e = src[n], gate = (v: number) => f.only === 'neg' ? Math.min(v, 0) : f.only === 'pos' ? Math.max(v, 0) : v;
      const m = (v: number, k: number) => (f.abs ? Math.abs(gate(v)) : gate(v)) * k;
      this.pose[i].setFromEuler(this.eul.set(m(e.x, f.k[0]), m(e.y, f.k[1]), m(e.z, f.k[2])));
    });
    this.followers.forEach(({ j, f }, n) => {
      if (!f.split) return;
      const e = src[n];
      this.pose[j].setFromEuler(this.eul.set(e.x * (1 - f.k[0]), e.y * (1 - f.k[1]), e.z * (1 - f.k[2])));
    });
  }

  /** World skin matrix per bone: M_b = M_parent * T(h) * R * T(-h). Copies into `out` (shader uniforms) if given. */
  update(out?: THREE.Matrix4[]) {
    this.applyFollowers();
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
