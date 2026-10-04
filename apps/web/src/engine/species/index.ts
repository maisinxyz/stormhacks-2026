import type { Species } from '@fetch/contracts';
import { bird } from './bird';
import { dog, quadClips } from './dog';
import type { SpeciesPack } from './types';

export type { SpeciesPack, VerbAnim, ParticleKind, FeedItem } from './types';

// Stretch species: PRD 1.4 data is complete, but clips/verbs reuse the dog's quadruped set until their own are authored.
const cat: SpeciesPack = {
  ...dog, id: 'cat', stretch: true, clips: quadClips,
  idleList: ['sitWatch', 'flop', 'sit', 'stand'], workIdle: ['flop', 'sitWatch', 'perk'],
  locomotion: { walk: 'stalk', run: 'run' },
  intents: { ...dog.intents, trick: 'bat', speak: 'perk' },
  reactions: { pet: 'perk', poke: 'bat', feed: 'perk' },
  exit: { style: 'run', particle: 'puff' }, enter: { style: 'run', particle: 'puff' },
  peek: { scene: 'ledge', yaw: Math.PI, y: 0.15, wag: 'perk' }, // tail flicking from behind a ledge
  foods: ['fish'], games: ['laser_dot', 'box', 'string'],
  voicePrompt: 'sassy, competent, dry-witted cat',
  personality: { eager: 0.3, sassy: 0.9, anxious: 0.2, chatty: 0.4 },
};
const rodent: SpeciesPack = {
  ...dog, id: 'rodent', stretch: true, clips: quadClips,
  idleList: ['stand', 'sniff', 'tuck', 'perk'], workIdle: ['perk', 'sniff'],
  carry: { bone: 'head', offset: [0, -0.1, 0.05], socket: 'cheek_pouch' },
  exit: { style: 'dig', particle: 'dirt' }, enter: { style: 'dig', particle: 'dirt' },
  peek: { scene: 'burrow', yaw: 0, y: 0, hidden: true, wag: 'perk' }, // dirt pile growing at a burrow
  foods: ['seed'], games: ['maze_builder', 'wheel'],
  voicePrompt: 'anxious, thorough, squeaky hamster',
  personality: { eager: 0.4, sassy: 0.1, anxious: 0.9, chatty: 0.5 },
};

export const PACKS: Record<Species, SpeciesPack> = { dog, cat, rodent, bird };
