// The voice-command tricks, shared by the camera view and the first-person room: a command id becomes a list of
// behaviour steps for the engine. Directions are the user's own: left/right across their view, "up" away, "down" toward.
import * as THREE from 'three';
import type { Engine } from '../engine';
import type { PerformStep } from '../engine/behavior';
import type { CommandId } from './commands';

export interface TrickEnv {
  engine: Engine;
  /** The user's eye and the way they face. Read again when a step runs, so a moving player is still faced correctly. */
  eye: THREE.Vector3; forward: THREE.Vector3;
  /** Nearest and farthest the pet may be sent from the user, metres. */
  reach: [number, number];
  /** Sit and lie down: true = until the next command (camera view), a number = that many seconds (room: the pet has its own life). */
  hold: true | number;
  /** Bark: sound plus whatever the view shows for it. */
  woof(): void;
}

let lastSurprise = -1;

/** Every command except "follow" (how to follow depends on the view). */
export function commandSteps(id: Exclude<CommandId, 'follow'>, env: TrickEnv): PerformStep[] {
  const e = env.engine, p = e.petPosition, eye = env.eye;
  const f = env.forward.clone(); f.y = 0;
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
  f.normalize();
  const right = new THREE.Vector3(-f.z, 0, f.x), foot = new THREE.Vector3(eye.x, 0, eye.z);
  /** A floor point `a` metres to the user's right and `b` metres away from them, kept within reach. */
  const by = (a: number, b: number) => { const d = new THREE.Vector3(p.x, 0, p.z).addScaledVector(right, a).addScaledVector(f, b).sub(foot); return foot.clone().add(d.setLength(THREE.MathUtils.clamp(d.length(), env.reach[0], env.reach[1]))); };
  /** The point `dist` metres from the user, on the line to the pet. */
  const near = (dist: number) => { const d = new THREE.Vector3(p.x - foot.x, 0, p.z - foot.z); if (d.lengthSq() < 1e-4) d.copy(f); return foot.clone().add(d.setLength(dist)); };
  const face: PerformStep = { call: () => e.faceToward(eye.x, eye.z) };
  const woof: PerformStep[] = [{ call: () => env.woof() }, { clip: 'perk', secs: 0.55 }];
  const hearts: PerformStep = { call: () => e.flourish('heart') }, sparkle: PerformStep = { call: () => e.flourish('sparkle') };
  const wag = (secs = 1.3, speed = 1): PerformStep => ({ clip: 'wag', secs, speed });
  const held = (clip: string): PerformStep => env.hold === true ? { clip, hold: true } : { clip, secs: env.hold };
  const go = (a: number, b: number): PerformStep[] => [{ to: by(a, b) }, face, { clip: 'stand', secs: 1 }];
  const tricks: PerformStep[][] = [
    [{ clip: 'beg', secs: 2.4 }], [{ clip: 'playBow', secs: 1.4 }, { clip: 'jump' }], [{ clip: 'spin' }, { clip: 'spin' }],
    [{ clip: 'roll' }, { clip: 'jump' }], [{ clip: 'hide', secs: 1.6 }, { clip: 'startle' }], [{ clip: 'scratch', secs: 2 }], [{ clip: 'count', secs: 2 }],
  ];
  const seq: Record<Exclude<CommandId, 'follow'>, () => PerformStep[]> = {
    sit: () => [face, held('sit')],
    come: () => [{ to: near(1.2), fast: true }, face, ...woof, wag(1.5)],
    lie: () => [face, held('lie')],
    jump: () => [face, { clip: 'jump' }, ...woof, wag(1)],
    left: () => go(-0.9, 0), right: () => go(0.9, 0), up: () => go(0, 0.9), down: () => go(0, -0.9),
    turn: () => [{ clip: 'spin' }, face, { clip: 'stand', secs: 0.6 }],
    love: () => [{ to: near(1), fast: true }, face, hearts, { clip: 'tilt', secs: 1.6 }, hearts, wag(1.5)],
    good: () => [face, hearts, { clip: 'jump' }, wag(1.6, 1.8)],
    paw: () => [face, { clip: 'shake', secs: 2.6 }],
    hi: () => [face, { clip: 'shake', secs: 1.6, speed: 1.4 }, ...woof],
    look: () => [face, { clip: 'perk', secs: 3 }],
    dance: () => [sparkle, { clip: 'dance', secs: 2.4 }, { clip: 'spin' }, face, ...woof],
    dead: () => [face, { clip: 'playDead', secs: 3.2 }, { clip: 'startle' }, wag(1)],
    roll: () => [{ clip: 'roll' }, { clip: 'stand', secs: 0.5 }],
    surprise: () => { let i = lastSurprise; while (i === lastSurprise) i = Math.floor(Math.random() * tricks.length); lastSurprise = i; return [sparkle, face, ...tricks[i]]; },
    stand: () => [{ clip: 'stand', secs: 0.3 }],
  };
  return seq[id]();
}
