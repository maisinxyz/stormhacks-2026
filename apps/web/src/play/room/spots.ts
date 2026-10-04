import type { FurnitureSpot } from '../../engine/behavior';

export const ROOM_SPOTS: FurnitureSpot[] = [
  { id: 'bed', position: { x: -3.35, z: -1.9 }, heading: 0, kind: 'sleep', clip: 'sleep', weight: (s) => 1 + Math.max(0, 45 - s.energy) / 35 },
  { id: 'bowl', position: { x: 4.05, z: -2.7 }, heading: Math.PI / 2, kind: 'eat', clip: 'sniff', weight: (s) => .4 + s.hunger / 35 },
  { id: 'rug', position: { x: 0, z: .15 }, heading: 0, kind: 'play', clip: 'playBow', weight: (s) => .7 + Math.max(0, 70 - s.happiness) / 80 },
  { id: 'window', position: { x: 0, z: -3.35 }, heading: 0, kind: 'watch', clip: 'sit', weight: (_s, _m, mode) => mode === 'play' ? .15 : .5 },
  { id: 'toybin', position: { x: -4.2, z: 1.65 }, heading: -.5, kind: 'fetch', clip: 'sniff', weight: (s) => .2 + (100 - s.happiness) / 250 },
];
