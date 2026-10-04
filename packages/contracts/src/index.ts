// Shared contracts (PRD 0.5 / 0.6). Owned by F2; frozen at hour 2.
export type Species = 'dog' | 'cat' | 'rodent' | 'bird';
export type Mode = 'work' | 'play';
export type Verb = 'SEARCH' | 'FETCH' | 'READ' | 'WRITE' | 'COMPARE' | 'ORGANIZE' | 'SEND' | 'WAIT'
  | 'MONITOR' | 'CALCULATE' | 'NEGOTIATE' | 'SUCCEED' | 'FAIL';
export type Mood = 'neutral' | 'eager' | 'focused' | 'proud' | 'sheepish' | 'exhausted' | 'worried' | 'smug' | 'sleepy';

export interface PetBundle {
  id: string; name: string; species: Species;
  splatUrl: string;      // .splat (32 bytes/splat: pos3f scale3f rgba4u8 rot4u8), rest pose
  rigUrl: string;        // rig.json
  weightsUrl: string;    // weights.bin: per splat 4x uint8 bone idx + 4x uint8 weight
  thumbnailUrl: string;
  voiceId?: string;
  personality: { eager: number; sassy: number; anxious: number; chatty: number };
  stats: { energy: number; happiness: number; hunger: number };
  createdAt: string;
}

export interface ResultCard { title: string; text?: string; url?: string }

export interface ActionStep {
  id: string; verb: Verb; mood: Mood;
  prop?: { kind: 'preset' | 'generated'; name: string; imageUrl?: string };
  label: string;
  toolCallId?: string;
}

export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'run.plan'; steps: ActionStep[] }
  | { type: 'run.say'; text: string }
  | { type: 'tool.start'; stepId: string; tool: string; label: string }
  | { type: 'tool.progress'; stepId: string; note: string; itemsRead?: number }
  | { type: 'tool.retry'; stepId: string; attempt: number }
  | { type: 'tool.end'; stepId: string; ok: boolean }
  | { type: 'approval.required'; actionId: string; kind: 'send_email' | 'delete' | 'share' | 'calendar_invite' | 'other';
      preview: { to?: string[]; subject?: string; body?: string; summary: string }; contentHash: string }
  | { type: 'run.result'; summary: string; card?: ResultCard; prop?: ActionStep['prop']; mood: Mood }
  | { type: 'run.error'; code: string; message: string; mood: 'sheepish' | 'exhausted' }
  | { type: 'run.cancelled' };

export type LocalIntent = 'sit' | 'stay' | 'come' | 'speak' | 'roll_over' | 'spin' | 'play_dead' | 'shake'
  | 'fetch_ball' | 'sleep' | 'wake' | 'trick' | 'dance' | 'hide' | 'stop';

export type BusEvent =
  | { type: 'PET_STROKE'; intensity: number }
  | { type: 'POKE' }
  | { type: 'FEED'; item: 'treat' | 'fish' | 'seed' | 'cracker' }
  | { type: 'THROW'; vx: number; vy: number }
  | { type: 'PET_AT_PLATFORM'; platformId: string }
  | { type: 'ENGINE_READY' } | { type: 'RETURNED'; runId: string } | { type: 'ANIM_DONE'; id: string }
  | { type: 'COMMAND_LOCAL'; intent: LocalIntent }
  | { type: 'MODE'; mode: Mode }
  | { type: 'APPROVE'; actionId: string } | { type: 'CANCEL'; runId?: string }
  | { type: 'POINT'; x: number; y: number }
  | { type: 'COMMAND'; text: string; source: 'voice' | 'text' };

export interface Platform { id: string; x: number; y: number; w: number; h: number; kind: 'window' | 'card' | 'edge' }

export interface PetEngine {
  mount(canvas: HTMLCanvasElement, peekCanvas: HTMLCanvasElement): void;
  loadPet(bundle: PetBundle): Promise<void>;
  setMode(mode: Mode): void;
  setPlatforms(p: Platform[]): void;
  runPlan(steps: ActionStep[]): void;
  pushToolEvent(e: RunEvent): void;
  showResult(prop: ActionStep['prop'], mood: Mood): void;
  setApprovalPending(pending: boolean): void;
  doIntent(i: LocalIntent): void;
  setSpeaking(amplitude: number): void;
  generatePet(input: { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string },
              onProgress: (p: { stage: string; pct: number }) => void): Promise<PetBundle>;
  on<T extends BusEvent['type']>(t: T, cb: (e: Extract<BusEvent, { type: T }>) => void): void;
}
