import type { FurnitureSpot } from '../../engine/behavior';
import { ROOM_SPEC as S } from '../scene';

// Where the pet goes by itself, one spot per need. Headings: 0 faces +z (the door), PI faces the window, -PI/2 faces -x.
export const ROOM_SPOTS: FurnitureSpot[] = [
  { id: 'bed', position: { x: S.bed.x, z: S.bed.z }, heading: -Math.PI / 2, kind: 'sleep', clip: 'sleep', weight: (s) => 1 + Math.max(0, 45 - s.energy) / 35 },
  { id: 'bowl', position: { x: S.bowl.x - 0.55, z: S.bowl.z }, heading: Math.PI / 2, kind: 'eat', clip: 'sniff', weight: (s) => .4 + s.hunger / 35 },
  { id: 'rug', position: { x: S.rug.x, z: S.rug.z }, heading: 0, kind: 'play', clip: 'playBow', weight: (s) => .7 + Math.max(0, 70 - s.happiness) / 80 },
  { id: 'window', position: { x: 0, z: -3.1 }, heading: Math.PI, kind: 'watch', clip: 'sit', weight: (_s, _m, mode) => mode === 'play' ? .15 : .5 },
  { id: 'toybin', position: { x: S.chest.x + 0.85, z: S.chest.z }, heading: -Math.PI / 2, kind: 'fetch', clip: 'sniff', weight: (s) => .2 + (100 - s.happiness) / 250 },
];
