import type { ActionStep, Mode, Mood, PetBundle, PetEngine, PlatformRect, RunEvent, LocalIntent } from './contracts'

export class MockPetEngine implements PetEngine {
  private status = 'perched'
  private mode: Mode = 'work'

  mount(_canvas: HTMLCanvasElement, _peekCanvas: HTMLCanvasElement) {}
  async loadPet(_bundle: PetBundle) { return Promise.resolve() }
  setMode(mode: Mode) { this.mode = mode }
  setPlatforms(_platforms: PlatformRect[]) {}
  runPlan(_steps: ActionStep[]) { this.status = 'on an errand' }
  pushToolEvent(event: RunEvent) {
    if (event.type === 'run.result' || event.type === 'run.error' || event.type === 'run.cancelled') this.status = 'perched'
  }
  showResult(_prop: ActionStep['prop'], _mood: Mood) { this.status = 'perched' }
  setApprovalPending(pending: boolean) { this.status = pending ? 'waiting for approval' : 'perched' }
  setSpeaking(_amplitude: number) {}
  doIntent(intent: LocalIntent) { this.status = intent.replace('_', ' ') }
  getStatus() { return this.status }
  getMode() { return this.mode }
}
