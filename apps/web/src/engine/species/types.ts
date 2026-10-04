import type { LocalIntent, Species, Verb } from '@fetch/contracts';
import type { Clip } from '../anim';

export type ParticleKind = 'dust' | 'feather' | 'dirt' | 'puff';
export type FeedItem = 'treat' | 'fish' | 'seed' | 'cracker';
export interface VerbAnim {
  clips: string[];            // composed from base clips, played in order and cycled
  prop?: 'carry' | 'world';   // where the step's prop attaches
  particle?: ParticleKind;    // burst on step start
  speed?: number;
}

/** One folder/file per species (PRD 1.4). Adding a species = adding one pack. */
export interface SpeciesPack {
  id: Species;
  template: 'quadruped' | 'biped_wings';
  stretch?: boolean; // data-complete but reuses another species' clips until its own are authored
  clips: Record<string, Clip>;
  idleList: string[];
  workIdle: string[];         // perch/watch idles used near the Desk in Work mode
  locomotion: { walk: string; run: string };
  listenClip: string;
  intents: Partial<Record<LocalIntent, string>>;
  reactions: { pet: string; poke: string; feed: string };
  carry: { bone: string; offset: [number, number, number]; socket: string };
  exit: { style: string; particle: ParticleKind };
  enter: { style: string; particle: ParticleKind };
  foods: FeedItem[];
  games: string[];
  voicePrompt: string;
  personality: { eager: number; sassy: number; anxious: number; chatty: number };
  verbs: Record<Verb, VerbAnim>;
  /** Edge-peek scene (PRD 1.9): what the dock shows while the pet is off-canvas. */
  peek: { scene: 'bush' | 'ledge' | 'burrow' | 'nest'; yaw: number; y: number; hidden?: boolean; wag: string };
}
