// Procedural animation core: clips are pure functions of time, blended by the Animator.
import type { Mood } from '@fetch/contracts';

export type V3 = [number, number, number];
/** Euler rotations (rad) per bone about its rest-pose head, plus whole-body offsets. */
export interface Pose { bones: Record<string, V3>; y?: number; yaw?: number }
export interface Clip {
  dur: number;
  loop: boolean;
  move?: number; // forward world units/sec while playing (locomotion)
  fn: (p: number, t: number) => Pose; // p = phase 0..1 within dur, t = seconds since start
}

export const TAU = Math.PI * 2;
export const sw = (p: number, a: number, ph = 0) => Math.sin(p * TAU + ph) * a;
export const clip = (dur: number, loop: boolean, fn: Clip['fn'], move?: number): Clip => ({ dur, loop, fn, move });
/** Smooth 0->1->hold ramp for non-looping holds. */
export const ease = (t: number, d = 0.25) => { const x = Math.min(1, t / d); return x * x * (3 - 2 * x); };

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function blend(a: Pose, b: Pose, k: number): Pose {
  const bones: Record<string, V3> = {};
  for (const n of new Set([...Object.keys(a.bones), ...Object.keys(b.bones)])) {
    const x = a.bones[n] ?? [0, 0, 0], y = b.bones[n] ?? [0, 0, 0];
    bones[n] = [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  }
  return { bones, y: lerp(a.y ?? 0, b.y ?? 0, k), yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, k) };
}

export class Animator {
  private cur?: { clip: Clip; t: number; speed: number };
  private from: Pose = { bones: {} };
  private k = 1;
  pose: Pose = { bones: {} };
  done = false; // true once a non-looping clip finished (pose then holds its last frame)
  get clip() { return this.cur?.clip; }
  get speed() { return this.cur?.speed ?? 1; }

  play(c: Clip, speed = 1, fade = 0.2) {
    this.from = this.pose;
    this.k = fade > 0 ? 0 : 1;
    this.cur = { clip: c, t: 0, speed };
    this.done = false;
  }

  update(dt: number, fade = 0.2): Pose {
    const c = this.cur;
    if (!c) return this.pose;
    c.t += dt * c.speed;
    const t = c.clip.loop ? c.t : Math.min(c.t, c.clip.dur);
    if (!c.clip.loop && c.t >= c.clip.dur) this.done = true;
    const target = c.clip.fn(c.clip.loop ? (t / c.clip.dur) % 1 : Math.min(1, t / c.clip.dur), t);
    this.k = Math.min(1, this.k + dt / fade);
    this.pose = this.k < 1 ? blend(this.from, target, this.k) : target;
    return this.pose;
  }
}

/** Mood changes pace, posture, and tail/head pose (PRD 1.5). */
export const MOODS: Record<Mood, { speed: number; head: number; tail: number; y: number }> = {
  neutral: { speed: 1, head: 0, tail: 0, y: 0 },
  eager: { speed: 1.25, head: -0.1, tail: -0.1, y: 0 },
  focused: { speed: 1, head: 0.12, tail: 0, y: 0 },
  proud: { speed: 1, head: -0.3, tail: -0.2, y: 0.02 },
  sheepish: { speed: 0.8, head: 0.5, tail: 0.6, y: -0.03 },
  exhausted: { speed: 0.6, head: 0.6, tail: 0.7, y: -0.06 },
  worried: { speed: 1.1, head: 0.2, tail: 0.4, y: 0 },
  smug: { speed: 0.9, head: -0.2, tail: -0.05, y: 0 },
  sleepy: { speed: 0.6, head: 0.45, tail: 0.3, y: -0.04 },
};

export function applyMood(p: Pose, mood: Mood): Pose {
  const m = MOODS[mood];
  if (mood === 'neutral') return p;
  const bones = { ...p.bones };
  const h = bones.head ?? [0, 0, 0], t = bones.tail ?? [0, 0, 0];
  bones.head = [h[0] + m.head, h[1], h[2]];
  bones.tail = [t[0] - m.tail, t[1], t[2]];
  return { ...p, bones, y: (p.y ?? 0) + m.y };
}
