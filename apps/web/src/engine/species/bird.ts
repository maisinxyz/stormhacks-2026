import { clip, ease, sw, TAU, type Clip, type Pose } from '../anim';
import type { SpeciesPack } from './types';

const P = (bones: Pose['bones'], y = 0, yaw = 0): Pose => ({ bones, y, yaw });
// Skeleton: root, head, tail, wingL(+x), wingR(-x), legL, legR. Wing z>0 raises wingL; wingR raises with z<0.
const wings = (l: number, r = -l): Pose['bones'] => ({ wingL: [0, 0, l], wingR: [0, 0, r] });
const flap = (p: number, a: number, base = 0.2) => wings(base + sw(p, a), -(base + sw(p, a)));

const clips: Record<string, Clip> = {
  perch: clip(2.5, true, p => P({ root: [sw(p, 0.02), 0, 0], head: [0, sw(p, 0.3), 0], ...wings(-0.15), tail: [0, sw(p, 0.1, 1), 0] })),
  preen: clip(2, true, p => P({ head: [0.6 + sw(p * 3, 0.1), 0.9 * Math.sign(sw(p, 1)) * 0.6, 0.2], ...wings(-0.1) })),
  headTilt: clip(1.6, true, p => P({ head: [0, sw(p, 0.2), sw(p, 0.55)], ...wings(-0.15) })),
  scan: clip(2.4, true, p => P({ head: [0, sw(p, 0.9), 0], ...wings(-0.15) })),
  hop: clip(0.5, true, p => P({ legL: [-sw(p, 0.4), 0, 0], legR: [-sw(p, 0.4), 0, 0], ...wings(-0.1), head: [0.1, 0, 0] }, Math.max(0, sw(p, 0.12))), 0.4),
  flapHop: clip(0.5, true, p => P({ ...flap(p, 0.9, 0.3), legL: [-0.3, 0, 0], legR: [-0.3, 0, 0], root: [-0.15, 0, 0] }, Math.max(0, sw(p, 0.2))), 0.9),
  fly: clip(0.4, true, p => P({ ...flap(p, 1.0, 0.1), legL: [0.8, 0, 0], legR: [0.8, 0, 0], root: [0.2, 0, 0], tail: [-0.3, 0, 0] }, 0.3), 3),
  circle: clip(1.6, true, p => P({ ...flap(p * 4, 0.9, 0.1), legL: [0.8, 0, 0], legR: [0.8, 0, 0], root: [0.2, 0, sw(p, 0.0)] }, 0.35, p * TAU)),
  fluff: clip(1.2, true, p => P({ ...wings(0.35 + sw(p * 8, 0.06), -0.35 - sw(p * 8, 0.06)), head: [-0.1, 0, 0], tail: [0, 0, 0.3] })),
  squawk: clip(0.8, true, p => P({ head: [-0.5 * Math.max(0, sw(p * 2, 1)), 0, 0], ...flap(p * 2, 0.7, 0.4) }, Math.max(0, sw(p * 2, 0.05)))),
  danceBob: clip(0.7, true, p => P({ head: [sw(p * 2, 0.3), sw(p, 0.4), 0], root: [0, 0, sw(p, 0.2)], tail: [0, sw(p, 0.6), 0], ...wings(0.1 + sw(p, 0.2), -0.1 - sw(p, 0.2)) }, Math.abs(sw(p, 0.07)))),
  whistle: clip(1.6, true, p => P({ head: [-0.35 + sw(p * 3, 0.08), 0, 0.1], ...wings(0.25, -0.25), tail: [0, 0, 0.25] }, 0.02)),
  droop: clip(2, true, (_p, t) => { const e = ease(t, 0.5); return P({ head: [0.7 * e, 0, 0], ...wings(-0.6 * e), tail: [-0.5 * e, 0, 0] }, -0.05 * e); }),
  yawn: clip(1.6, false, p => { const k = Math.sin(Math.min(1, p) * Math.PI); return P({ head: [-0.6 * k, 0, 0], ...wings(0.35 * k, -0.35 * k) }); }),
  peck: clip(0.45, true, p => P({ head: [0.9 * Math.max(0, sw(p, 1)), 0, 0], root: [0.2, 0, 0], ...wings(-0.1) })),
  sleep: clip(4, true, (p, t) => { const e = ease(t, 0.6); return P({ head: [0.2 * e, 2.6 * e, 0], ...wings(-0.4 * e), root: [sw(p, 0.02), 0, 0] }, -0.06 * e); }),
  spinTurn: clip(1, false, p => P({ ...flap(p * 3, 0.5, 0.3) }, 0.05, p * TAU)),
  peckKeys: clip(0.3, true, p => P({ head: [0.6 + sw(p, 0.3), 0, 0], root: [0.25, 0, 0], ...wings(-0.1) })),
  hopBetween: clip(1.2, true, p => P({ legL: [-sw(p * 2, 0.4), 0, 0], legR: [-sw(p * 2, 0.4), 0, 0], head: [0, sw(p, 0.6), 0], ...wings(-0.1) }, Math.max(0, sw(p * 2, 0.1)))),
  count: clip(0.5, true, p => P({ head: [0.9 * Math.max(0, sw(p * 1, 1)), 0, 0], ...wings(-0.1) })),
  celebrate: clip(1, false, p => P({ ...flap(p * 3, 0.6, 0.3), head: [-0.4, 0, 0], tail: [0, 0, 0.3] }, Math.sin(p * Math.PI) * 0.15)),
};

export const bird: SpeciesPack = {
  id: 'bird', template: 'biped_wings', clips,
  idleList: ['perch', 'preen', 'headTilt', 'scan'],
  workIdle: ['perch', 'preen', 'headTilt'],
  locomotion: { walk: 'hop', run: 'flapHop' },
  listenClip: 'headTilt',
  intents: { sit: 'perch', stay: 'perch', come: 'flapHop', speak: 'squawk', roll_over: 'spinTurn', spin: 'spinTurn', play_dead: 'droop', shake: 'headTilt',
    fetch_ball: 'hop', sleep: 'sleep', wake: 'perch', trick: 'whistle', dance: 'danceBob', hide: 'droop', stop: 'perch' },
  reactions: { pet: 'fluff', poke: 'squawk', feed: 'peck' },
  carry: { bone: 'legL', offset: [0, 0, 0], socket: 'talons' },
  exit: { style: 'fly', particle: 'feather' }, enter: { style: 'fly', particle: 'feather' },
  foods: ['seed', 'cracker'], games: ['mimic', 'land_on_cursor', 'perch_hop'],
  voicePrompt: 'chatty, gossipy parrot with a bright squawk',
  personality: { eager: 0.5, sassy: 0.4, anxious: 0.3, chatty: 0.95 },
  peek: { scene: 'nest', yaw: 0.3, y: 0.15, wag: 'fluff' }, // in a nest, wings flapping
  verbs: {
    SEARCH: { clips: ['circle', 'scan'], particle: 'feather' },
    FETCH: { clips: ['fly', 'flapHop'], prop: 'carry', particle: 'feather' },
    READ: { clips: ['headTilt', 'perch'], prop: 'world' },
    WRITE: { clips: ['peckKeys'], prop: 'world' },
    COMPARE: { clips: ['hopBetween'], prop: 'world' },
    ORGANIZE: { clips: ['hop', 'peck'], prop: 'world' },
    SEND: { clips: ['fly'], prop: 'carry', particle: 'feather' },
    WAIT: { clips: ['preen'] },
    MONITOR: { clips: ['scan', 'perch'] },
    CALCULATE: { clips: ['count'], prop: 'world' },
    NEGOTIATE: { clips: ['squawk', 'perch'] },
    SUCCEED: { clips: ['celebrate', 'whistle'], particle: 'puff' },
    FAIL: { clips: ['droop'] },
  },
};
