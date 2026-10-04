import type { FurnitureSpot } from '../../engine/behavior';

export const ROOM_SPOTS: FurnitureSpot[] = [
  { id: 'bed', position: { x: -1.05, z: -1.18 }, heading: 0, kind: 'sleep', clip: 'sleep', weight: (s) => 1 + Math.max(0, 45 - s.energy) / 35 },
  { id: 'bowl', position: { x: 1.25, z: -1.3 }, heading: Math.PI / 2, kind: 'eat', clip: 'sniff', weight: (s) => .4 + s.hunger / 35 },
  { id: 'rug', position: { x: 0, z: .15 }, heading: 0, kind: 'play', clip: 'playBow', weight: (s) => .7 + Math.max(0, 70 - s.happiness) / 80 },
  { id: 'window', position: { x: 0, z: -1.35 }, heading: 0, kind: 'watch', clip: 'sit', weight: (_s, _m, mode) => mode === 'play' ? .15 : .5 },
  { id: 'toybin', position: { x: -1.55, z: .75 }, heading: -.5, kind: 'fetch', clip: 'sniff', weight: (s) => .2 + (100 - s.happiness) / 250 },
];
