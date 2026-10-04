export type Species = 'dog' | 'cat' | 'rodent' | 'bird'
export type Mode = 'work' | 'play'
export type Mood = 'neutral' | 'eager' | 'focused' | 'proud' | 'sheepish' | 'exhausted' | 'worried' | 'smug' | 'sleepy'
export type LocalIntent = 'sit' | 'stay' | 'come' | 'speak' | 'roll_over' | 'spin' | 'play_dead' | 'shake' | 'fetch_ball' | 'sleep' | 'wake' | 'trick' | 'dance' | 'hide' | 'stop'

export type Verb = 'SEARCH' | 'FETCH' | 'READ' | 'WRITE' | 'COMPARE' | 'ORGANIZE' | 'SEND' | 'WAIT' | 'MONITOR' | 'CALCULATE' | 'NEGOTIATE' | 'SUCCEED' | 'FAIL'

export interface PetBundle {
  id: string
  name: string
  species: Species
  splatUrl: string
  rigUrl: string
  weightsUrl: string
  thumbnailUrl: string
  voiceId?: string
  personality: { eager: number; sassy: number; anxious: number; chatty: number }
  stats: { energy: number; happiness: number; hunger: number }
  createdAt: string
}

export interface ActionStep {
  id: string
  verb: Verb
  mood: Mood
  label: string
  prop?: { kind: 'preset' | 'generated'; name: string; imageUrl?: string }
}

export type RunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'run.plan'; steps: ActionStep[] }
  | { type: 'run.say'; text: string }
  | { type: 'tool.start'; stepId: string; tool: string; label: string }
  | { type: 'tool.progress'; stepId: string; note: string; itemsRead?: number }
  | { type: 'tool.retry'; stepId: string; attempt: number }
  | { type: 'tool.end'; stepId: string; ok: boolean }
  | { type: 'approval.required'; actionId: string; kind: 'send_email' | 'delete' | 'share' | 'calendar_invite' | 'other'; preview: { to?: string[]; subject?: string; body?: string; summary: string }; contentHash: string }
  | { type: 'run.result'; summary: string; mood: Mood; prop?: ActionStep['prop'] }
  | { type: 'run.error'; code: string; message: string; mood: 'sheepish' | 'exhausted' }
  | { type: 'run.cancelled' }

export interface PlatformRect { id: string; x: number; y: number; w: number; h: number; kind: 'window' | 'card' | 'edge' }

export interface PetEngine {
  mount(canvas: HTMLCanvasElement, peekCanvas: HTMLCanvasElement): void
  loadPet(bundle: PetBundle): Promise<void>
  setMode(mode: Mode): void
  setPlatforms(platforms: PlatformRect[]): void
  runPlan(steps: ActionStep[]): void
  pushToolEvent(event: RunEvent): void
  showResult(prop: ActionStep['prop'], mood: Mood): void
  setApprovalPending(pending: boolean): void
  setSpeaking(amplitude: number): void
  doIntent(intent: LocalIntent): void
}
