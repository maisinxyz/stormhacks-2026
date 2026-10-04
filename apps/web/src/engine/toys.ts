// Physics toys (PRD 1.8): a Rapier world on the z=0 stage with ground + platforms; currently the ball.
// ponytail: only the ball (dog). String/box (cat), wheel (rodent), perch (bird) land with their packs.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export const BALL_R = 0.07;
let rapierReady: Promise<void> | undefined;

export class Toys {
  private world?: RAPIER.World;
  private ball?: RAPIER.RigidBody;
  private statics: RAPIER.Collider[] = [];
  readonly sprite: THREE.Sprite;
  held = false;
  carried = false; // in the pet's mouth: hidden here, shown as the carry prop
  private bounds = { xmin: -3, xmax: 3 };

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    x.font = '52px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('🎾', 32, 36);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    this.sprite.scale.setScalar(BALL_R * 3);
    this.sprite.renderOrder = 8;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  async init() {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    this.world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
    this.setPlatforms([]);
  }

  /** Static colliders: ground (y=0) + one slab per platform top (world-space rects: x centre, y top, w). */
  setPlatforms(p: { x: number; y: number; w: number }[], bounds = this.bounds) {
    if (!this.world) return;
    this.bounds = bounds;
    this.statics.forEach(c => this.world!.removeCollider(c, false));
    this.statics = [];
    const slab = (x: number, y: number, hw: number) =>
      this.statics.push(this.world!.createCollider(RAPIER.ColliderDesc.cuboid(hw, 0.05, 0.5).setTranslation(x, y - 0.05, 0).setRestitution(0.5)));
    slab((bounds.xmin + bounds.xmax) / 2, 0, (bounds.xmax - bounds.xmin) / 2 + 2);
    p.forEach(s => slab(s.x, s.y, s.w / 2));
    // side walls keep the ball on stage
    for (const x of [bounds.xmin - 0.2, bounds.xmax + 0.2]) this.statics.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 20, 0.5).setTranslation(x, 0, 0).setRestitution(0.5)));
  }

  get present() { return !!this.ball; }
  get pos() { const t = this.ball!.translation(); return { x: t.x, y: t.y }; }
  get resting() { if (!this.ball) return true; const v = this.ball.linvel(); return !this.held && Math.hypot(v.x, v.y) < 0.15; }
  get hittable() { return !!this.ball && !this.carried; }

  spawn(x: number, y: number) {
    if (!this.world) return;
    if (this.ball) this.world.removeRigidBody(this.ball);
    this.ball = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0)
      .enabledTranslations(true, true, false).enabledRotations(false, false, false).setLinearDamping(0.15).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(BALL_R).setRestitution(0.65).setFriction(0.8), this.ball);
    this.sprite.visible = true;
    this.carried = false;
  }

  /** Drag: ball follows the pointer kinematically-ish (zero gravity effect via position set). */
  hold(x: number, y: number) {
    if (!this.ball) return;
    this.held = true;
    this.ball.setTranslation({ x, y, z: 0 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  release(vx: number, vy: number) {
    this.held = false;
    this.ball?.setLinvel({ x: vx, y: vy, z: 0 }, true);
  }

  /** Pet picked it up. */
  take() { this.carried = true; this.sprite.visible = false; this.ball?.setEnabled(false); }
  drop(x: number, y: number) {
    this.carried = false; this.sprite.visible = true;
    this.ball?.setEnabled(true);
    this.ball?.setTranslation({ x, y, z: 0 }, true);
    this.ball?.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  step(dt: number) {
    if (!this.world || !this.ball) return;
    if (!this.held && !this.carried) this.world.timestep = Math.min(dt, 1 / 30), this.world.step();
    if (!this.carried) { const t = this.ball.translation(); this.sprite.position.set(t.x, t.y, 0.15); }
  }
}
