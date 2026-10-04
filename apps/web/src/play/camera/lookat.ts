// play.md B.6: the "alive" layer for the camera view. The dog glances at the user and looks away (head only).
// It never moves the body: in the camera view the dog only moves on a command. Breathing and tail come from the engine.
// No blink: the splat has no modelled eyes (documented limit).
import * as THREE from 'three';
import type { Engine } from '../../engine';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Alive {
  private lookUser = true;
  private until = 0;
  private gaze = new THREE.Vector3();
  private t = 0;

  constructor(private engine: Engine) {}

  /** Hold the dog's attention on the user (tap, greeting, voice). */
  focus(secs = 2.5) { this.lookUser = true; this.until = this.t + secs; }

  /** Entering the camera view: face the user and say hello. */
  enter() { this.focus(3); this.engine.react('pet'); } // wag hello (no happiness bump: that is for real taps)

  exit() { this.engine.setLookAt(null); }

  update(dt: number) {
    const e = this.engine;
    this.t += dt;
    // gaze: look at the user for 1-3 s, then away at a random spot on the floor, at irregular intervals
    if (this.t > this.until) {
      this.lookUser = !this.lookUser;
      this.until = this.t + (this.lookUser ? rand(1, 3) : rand(1.5, 4));
      if (!this.lookUser) { const p = e.petPosition; this.gaze.set(p.x + rand(-1.5, 1.5), p.y + rand(0, 0.3), p.z + rand(-1.5, 1.5)); }
    }
    e.setLookAt(this.lookUser ? e.camera.position : this.gaze);
  }
}
