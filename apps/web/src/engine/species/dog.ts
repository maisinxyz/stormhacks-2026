import { clip, ease, sw, TAU, type Clip, type Pose } from '../anim';
import type { SpeciesPack } from './types';

const P = (bones: Pose['bones'], y = 0, yaw = 0): Pose => ({ bones, y, yaw });
const breathe = (p: number) => sw(p, 0.015);
const wag = (p: number, f = 1, a = 0.7) => sw(p * f, a);

// Skeleton: root, head, tail, legFL/FR/BL/BR. Rotation about +x lowers forward (+z) points; leg x<0 swings forward.
const sitPose = (t: number, extra: Pose['bones'] = {}): Pose => {
  const e = ease(t);
  return P({ root: [-0.55 * e, 0, 0], legBL: [1.25 * e, 0, 0], legBR: [1.25 * e, 0, 0], legFL: [0.1 * e, 0, 0], legFR: [0.1 * e, 0, 0], head: [0.55 * e, 0, 0], ...extra }, -0.17 * e);
};
const lieDown = (e: number): Pose['bones'] => ({ legFL: [-0.6 * e, 0, 0.5 * e], legFR: [-0.6 * e, 0, -0.5 * e], legBL: [0.6 * e, 0, 0.5 * e], legBR: [0.6 * e, 0, -0.5 * e] });

export const quadClips: Record<string, Clip> = {
  stand: clip(2.5, true, p => P({ root: [breathe(p), 0, 0], tail: [0, sw(p, 0.2, 1), 0] })),
  perk: clip(1, true, p => P({ head: [-0.3, sw(p, 0.1), sw(p, 0.25)], tail: [0, wag(p, 2, 0.3), 0] })),
  sit: clip(2, true, (p, t) => sitPose(t, { tail: [0, sw(p, 0.35), 0] })),
  scratch: clip(0.5, true, (p, t) => sitPose(t, { legBL: [1.0 + sw(p * 4, 0.45), 0, 0], head: [0.5, 0, sw(p * 4, 0.1)] })),
  sniff: clip(1.2, true, p => P({ head: [0.6 + sw(p * 3, 0.12), sw(p, 0.35), 0], root: [0.1, 0, 0], tail: [0, wag(p, 2, 0.3), 0] })),
  walk: clip(0.8, true, p => P({
    legFL: [sw(p, 0.5), 0, 0], legBR: [sw(p, 0.5), 0, 0], legFR: [-sw(p, 0.5), 0, 0], legBL: [-sw(p, 0.5), 0, 0],
    head: [0.1, sw(p, 0.08), 0], tail: [0, sw(p, 0.35), 0],
  }, Math.abs(sw(p * 2, 0.02))), 0.7),
  run: clip(0.42, true, p => P({
    legFL: [sw(p, 0.95), 0, 0], legFR: [sw(p, 0.95, 0.5), 0, 0], legBL: [sw(p, 0.95, 2.6), 0, 0], legBR: [sw(p, 0.95, 3.1), 0, 0],
    root: [sw(p, 0.12, 1.2), 0, 0], head: [-0.1, 0, 0], tail: [-0.3, sw(p, 0.2), 0],
  }, Math.max(0, sw(p, 0.1, 1.2))), 2.2),
  wag: clip(0.5, true, p => P({ tail: [-0.2, wag(p, 1, 0.9), 0], root: [breathe(p), 0, 0], head: [-0.1, 0, 0] })),
  playBow: clip(1.2, true, (p, t) => { const e = ease(t); return P({ root: [0.45 * e, 0, 0], legFL: [-0.3 * e, 0, 0], legFR: [-0.3 * e, 0, 0], head: [0.2 * e, 0, 0], tail: [-0.5, wag(p, 3, 0.8), 0] }, -0.05 * e); }),
  startle: clip(0.9, false, p => { const k = Math.sin(Math.min(1, p * 3) * Math.PI); return P({ root: [-0.2 * k, 0, 0], legFL: [-0.5 * k, 0, 0], legFR: [-0.5 * k, 0, 0], tail: [-0.6 * k, 0, 0] }, 0.18 * k); }),
  spin: clip(1, false, p => P({ legFL: [sw(p * 3, 0.5), 0, 0], legBR: [sw(p * 3, 0.5), 0, 0], legFR: [-sw(p * 3, 0.5), 0, 0], legBL: [-sw(p * 3, 0.5), 0, 0], tail: [-0.2, wag(p, 4, 0.5), 0] }, 0, p * TAU)),
  flop: clip(3, true, (p, t) => { const e = ease(t, 0.4); return P({ ...lieDown(e), root: [breathe(p) * 2, 0, 0], head: [0.2 * e, 0, 0] }, -0.3 * e); }),
  roll: clip(1.4, false, p => { const e = Math.sin(Math.min(1, p) * Math.PI); return P({ root: [0, 0, p * TAU], legFL: [-0.5, 0, 0], legFR: [-0.5, 0, 0], legBL: [0.5, 0, 0], legBR: [0.5, 0, 0] }, -0.28 * e); }),
  playDead: clip(2, true, (_p, t) => { const e = ease(t, 0.4); return P({ root: [0, 0, 1.45 * e], legFL: [-0.7 * e, 0, 0], legFR: [-0.7 * e, 0, 0], legBL: [0.7 * e, 0, 0], legBR: [0.7 * e, 0, 0], head: [0.3 * e, 0, 0] }, -0.3 * e); }),
  shake: clip(1, true, (p, t) => sitPose(t, { legFL: [-1.0 + sw(p * 3, 0.3), 0, 0], tail: [0, sw(p, 0.4), 0] })),
  beg: clip(1.2, true, (p, t) => sitPose(t, { legFL: [-1.4 + sw(p * 2, 0.2), 0, 0], legFR: [-1.4 - sw(p * 2, 0.2), 0, 0], head: [0.1, 0, sw(p, 0.2)] })),
  dance: clip(0.8, true, p => P({ root: [sw(p * 2, 0.15), 0, sw(p, 0.1)], legFL: [sw(p * 2, 0.5), 0, 0], legFR: [-sw(p * 2, 0.5), 0, 0], tail: [-0.2, wag(p * 2, 1, 0.9), 0] }, Math.abs(sw(p * 2, 0.08)))),
  hide: clip(1.5, true, (_p, t) => { const e = ease(t); return P({ root: [0.25 * e, 0, 0], head: [0.5 * e, 0, 0], ...lieDown(e * 0.6) }, -0.22 * e); }),
  sleep: clip(3.5, true, (p, t) => { const e = ease(t, 0.6); return P({ ...lieDown(e), root: [breathe(p) * 3, 0, 0], head: [0.5 * e, 0, 0] }, -0.32 * e); }),
  yawn: clip(1.6, false, p => { const k = Math.sin(Math.min(1, p) * Math.PI); return P({ head: [-0.7 * k, 0, 0], root: [-0.1 * k, 0, 0] }); }),
  dig: clip(0.5, true, p => P({ root: [0.3, 0, 0], legFL: [sw(p, 0.9), 0, 0], legFR: [-sw(p, 0.9), 0, 0], head: [0.5, 0, 0] }, -0.04)),
  pawKeys: clip(0.4, true, p => P({ root: [0.15, 0, 0], legFL: [-0.6 + sw(p, 0.3), 0, 0], legFR: [-0.6 - sw(p, 0.3), 0, 0], head: [0.4, 0, 0] })),
  nap: clip(3, true, (p, t) => { const e = ease(t, 0.5); return P({ ...lieDown(e), root: [breathe(p) * 2, 0, 0], head: [0.3 * e, 0, 0] }, -0.3 * e); }),
  tilt: clip(1.2, true, p => P({ head: [-0.05, 0, sw(p, 0.5)], tail: [0, wag(p, 1, 0.3), 0] })),
  sitWatch: clip(2.5, true, (p, t) => sitPose(t, { head: [0.3, sw(p, 0.5), 0] })),
  droop: clip(2, true, (_p, t) => { const e = ease(t, 0.5); return P({ ...lieDown(e * 0.8), head: [0.8 * e, 0, 0], tail: [0.4 * e, 0, 0] }, -0.28 * e); }),
  jump: clip(0.8, false, p => { const k = Math.sin(p * Math.PI); return P({ legFL: [-0.6 * k, 0, 0], legFR: [-0.6 * k, 0, 0], legBL: [0.6 * k, 0, 0], legBR: [0.6 * k, 0, 0], tail: [-0.5, wag(p, 4, 0.7), 0] }, 0.3 * k); }),
  count: clip(0.5, true, p => sitPose(1, { legFL: [-0.5 + Math.max(0, sw(p * 2, 0.5)), 0, 0], head: [0.5, 0, 0] })),
  stalk: clip(1, true, p => P({ legFL: [sw(p, 0.35), 0, 0], legBR: [sw(p, 0.35), 0, 0], legFR: [-sw(p, 0.35), 0, 0], legBL: [-sw(p, 0.35), 0, 0], root: [0.15, 0, 0], head: [0.25, 0, 0] }, -0.12), 0.35),
  bat: clip(0.6, true, p => P({ root: [0.2, 0, 0], legFL: [-0.7 + sw(p, 0.6), 0, 0], legFR: [-0.7 - sw(p, 0.6), 0, 0], head: [0.3, sw(p, 0.3), 0] })),
};

export const dog: SpeciesPack = {
  id: 'dog', template: 'quadruped', clips: quadClips,
  idleList: ['stand', 'sit', 'scratch', 'sniff', 'flop', 'roll', 'wag'],
  workIdle: ['sitWatch', 'flop', 'perk'],
  locomotion: { walk: 'walk', run: 'run' },
  listenClip: 'perk',
  intents: { sit: 'sit', stay: 'sit', come: 'run', speak: 'wag', roll_over: 'roll', spin: 'spin', play_dead: 'playDead', shake: 'shake',
    fetch_ball: 'playBow', sleep: 'sleep', wake: 'stand', trick: 'beg', dance: 'dance', hide: 'hide', stop: 'stand' },
  reactions: { pet: 'wag', poke: 'startle', feed: 'jump' },
  carry: { bone: 'head', offset: [0, -0.05, 0.12], socket: 'mouth' },
  exit: { style: 'run', particle: 'dust' }, enter: { style: 'run', particle: 'dust' },
  foods: ['treat'], games: ['ball_fetch', 'tug', 'hide_and_seek'],
  voicePrompt: 'eager, loyal, a bit overexcited scruffy dog',
  personality: { eager: 0.9, sassy: 0.2, anxious: 0.3, chatty: 0.5 },
  verbs: {
    SEARCH: { clips: ['sniff', 'walk'], particle: 'dust' },
    FETCH: { clips: ['dig', 'run'], prop: 'carry', particle: 'dirt' },
    READ: { clips: ['pawKeys', 'tilt'], prop: 'world' },
    WRITE: { clips: ['pawKeys'], prop: 'world' },
    COMPARE: { clips: ['tilt'], prop: 'world' },
    ORGANIZE: { clips: ['bat', 'walk'], prop: 'world' },
    SEND: { clips: ['run'], prop: 'carry', particle: 'dust' },
    WAIT: { clips: ['nap'] },
    MONITOR: { clips: ['perk', 'sitWatch'] },
    CALCULATE: { clips: ['count'], prop: 'world' },
    NEGOTIATE: { clips: ['beg', 'shake'] },
    SUCCEED: { clips: ['jump', 'wag'], particle: 'puff' },
    FAIL: { clips: ['droop'] },
  },
};
