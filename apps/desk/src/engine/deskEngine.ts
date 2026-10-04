// The real F1 engine (apps/web) on the Desk, behind the same PetEngine surface App.tsx already uses.
// Falls back to MockPetEngine when WebGL is unavailable or the renderer cannot start.
import { Engine } from '@fetch/web/src/engine/index'
import { generatePet as runPipeline } from '@fetch/web/src/engine/pipeline/generate'
import type { ActionStep, LocalIntent, Mode, Mood, PetBundle, PetEngine, PlatformRect, RunEvent, Species } from '../contracts'
import { MockPetEngine } from '../mockEngine'
import './deskEngine.css'

export interface GenerateInput { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string }
export interface GenerateProgress { stage: string; pct: number; detail?: string }
type EngineEvent = Parameters<Engine['pushToolEvent']>[0]

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') ?? c.getContext('webgl')) } catch { return false }
}

export class DeskEngine implements PetEngine {
  private real?: Engine
  private readonly mock = new MockPetEngine()
  private canvas?: HTMLCanvasElement
  private mounted = false
  private platforms: PlatformRect[] = []
  private loadedKey = ''
  private loads: Promise<void> = Promise.resolve()

  constructor() { if (hasWebGL()) this.real = new Engine() }

  /** True when the WebGL splat engine is running (false = mock fallback). */
  get isReal() { return !!this.real && this.mounted }

  mount(canvas: HTMLCanvasElement, peekCanvas: HTMLCanvasElement) {
    if (this.mounted) return // App re-runs its mount effect on every pet change; one renderer only
    this.mounted = true
    this.canvas = canvas
    this.mock.mount(canvas, peekCanvas)
    if (!this.real) return
    try {
      this.real.mount(canvas, peekCanvas) // sets pointer-events none and toggles it with hitTest on pointermove
      canvas.classList.add('live')
      const resync = () => this.setPlatforms(this.platforms)
      window.addEventListener('resize', resync)
      window.addEventListener('scroll', resync, true)
    } catch (err) {
      console.warn('3D engine failed to start, using the mock pet:', err)
      this.real = undefined
    }
  }

  async loadPet(bundle: PetBundle) {
    await this.mock.loadPet(bundle)
    const real = this.real
    const key = `${bundle.id}|${bundle.splatUrl}`
    if (!real || (!bundle.splatUrl && !bundle.plush) || key === this.loadedKey) return // a plush pet has traits instead of a splat file
    this.loadedKey = key
    // serialize loads so a slow earlier bundle can't replace a newer one
    this.loads = this.loads.then(async () => {
      if (this.loadedKey !== key) return
      try { await real.loadPet(bundle); this.canvas?.classList.add('has-pet') } catch (err) {
        console.warn(`could not load ${bundle.name}:`, err)
        if (this.loadedKey === key) this.loadedKey = ''
      }
    })
    return this.loads
  }

  /** App reports rects relative to the desk world; the engine wants viewport px, so offset by the canvas. */
  setPlatforms(platforms: PlatformRect[]) {
    this.platforms = platforms
    this.mock.setPlatforms(platforms)
    if (!this.real || !this.canvas || !this.isReal) return
    const r = this.canvas.getBoundingClientRect()
    this.real.setPlatforms(platforms.map((p) => ({ ...p, x: p.x + r.left, y: p.y + r.top })))
  }

  generatePet(input: GenerateInput, onProgress: (p: GenerateProgress) => void) {
    return this.real ? this.real.generatePet(input, onProgress) : runPipeline('', input, onProgress)
  }

  setMode(mode: Mode) { this.mock.setMode(mode); this.real?.setMode(mode) }
  runPlan(steps: ActionStep[]) { this.mock.runPlan(steps); this.real?.runPlan(steps as Parameters<Engine['runPlan']>[0]) }
  pushToolEvent(event: RunEvent) { this.mock.pushToolEvent(event); this.real?.pushToolEvent(event as EngineEvent) }
  showResult(prop: ActionStep['prop'], mood: Mood) { this.mock.showResult(prop, mood); this.real?.showResult(prop, mood) }
  setApprovalPending(pending: boolean) { this.mock.setApprovalPending(pending); this.real?.setApprovalPending(pending) }
  setSpeaking(amplitude: number) { this.real?.setSpeaking(amplitude) }
  doIntent(intent: LocalIntent) { this.mock.doIntent(intent); this.real?.doIntent(intent) }
  getStatus() { return this.mock.getStatus() }
  getMode() { return this.mock.getMode() }
}
