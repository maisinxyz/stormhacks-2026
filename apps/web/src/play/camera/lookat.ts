// play.md B.6: the "alive" layer for the camera view. The dog glances at the user, looks away, reacts to the phone
// being jolted, and trots back when it has been out of frame. Breathing, tail and idle clips come from the engine.
// No blink: the splat has no modelled eyes (documented limit).
import * as THREE from 'three';
import type { Engine } from '../../engine';
import type { PhonePose } from './pose';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const JOLT = 2.6;        // rad/s: a fast turn / sudden jolt of the phone
const OUT_SECS = 3;      // out of frame this long -> come back

export class Alive {
  private lookUser = true;
  private until = 0;
  private gaze = new THREE.Vector3();
  private lastStartle = -10;
  private outT = 0;
  private greet = false;
  private t = 0;

  /** `inViewGround` returns a floor point comfortably inside the current view (the dog walks there when lost). */
  constructor(private engine: Engine, private pose: PhonePose, private inViewGround: () => THREE.Vector3 | undefined) {}

  /** Hold the dog's attention on the user (tap, greeting, voice). */
  focus(secs = 2.5) { this.lookUser = true; this.until = this.t + secs; }

  /** Entering the camera view: face the user and say hello. */
  enter() { this.outT = 0; this.focus(3); this.engine.react('tap'); }

  exit() { this.engine.setLookAt(null); }

  update(dt: number, usePhoneMotion: boolean) {
    const e = this.engine;
    this.t += dt;
    // 1. gaze: look at the user for 1-3 s, then away at a random spot on the floor, at irregular intervals
    if (this.t > this.until) {
      this.lookUser = !this.lookUser;
      this.until = this.t + (this.lookUser ? rand(1, 3) : rand(1.5, 4));
      if (!this.lookUser) { const p = e.petPosition; this.gaze.set(p.x + rand(-1.5, 1.5), p.y + rand(0, 0.3), p.z + rand(-1.5, 1.5)); }
    }
    e.setLookAt(this.lookUser ? e.camera.position : this.gaze);

    // 2. phone motion: a fast turn or jolt startles it, then it looks to the user (steady movement is ignored)
    if (usePhoneMotion && this.pose.angularSpeed > JOLT && this.t - this.lastStartle > 4) {
      this.lastStartle = this.t;
      e.react('poke');
      this.focus(2);
    }

    // 3. out of frame for a while: trot back into view and greet
    const p = e.petPosition;
    p.y += 0.2 * e.petScale;
    const ndc = p.project(e.camera);
    const out = ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.1;
    this.outT = out && !e.travelling ? this.outT + dt : 0;
    if (this.outT > OUT_SECS) {
      this.outT = 0;
      const g = this.inViewGround();
      if (g) { e.placePet(g.x, g.z, true); this.greet = true; }
    }
    if (this.greet && !e.travelling) { this.greet = false; this.focus(3); e.react('tap'); }
  }
}
