import { Engine } from '../engine';
import { CameraView } from './camera/camera';
import { RoomView } from './room/room';
import { loadPetSession, snapshotEngine } from './session';
import type { PlayContext, PlayView, PlayViewId, PetSession, ShellErrorCode } from './types';

export class PlayShell {
  readonly engine: Engine; readonly session: PetSession; private views = new Map<PlayViewId, PlayView>(); private current?: PlayView; private last = 0; private raf = 0; private root: HTMLElement; private canvas: HTMLCanvasElement; private peek: HTMLCanvasElement;
  private constructor(engine: Engine, session: PetSession, root: HTMLElement, canvas: HTMLCanvasElement, peek: HTMLCanvasElement) { this.engine = engine; this.session = session; this.root = root; this.canvas = canvas; this.peek = peek; this.views.set('room', new RoomView()); this.views.set('camera', new CameraView()); }
  static async start() { const root = document.getElementById('play-root')!; const canvas = document.getElementById('play-canvas') as HTMLCanvasElement; const peek = document.getElementById('play-peek') as HTMLCanvasElement; const params = new URLSearchParams(location.search); const { session, fallback } = await loadPetSession(params.get('pet') ?? undefined); const shell = new PlayShell(new Engine(), session, root, canvas, peek); shell.engine.mount(canvas, peek); await shell.engine.loadPet(session.bundle); shell.engine.setQuality(session.quality); /* phone default: low */ if (fallback) shell.notice('Using Pip, the placeholder dog — this pet bundle was unavailable.'); await shell.switchTo('room'); shell.loop(); return shell; }
  private context(): PlayContext { return { engine: this.engine, session: this.session, root: this.root, canvas: this.canvas, switchTo: (view) => void this.switchTo(view), exit: () => { const env = (import.meta as ImportMeta & { env?: { VITE_DESK_APP_URL?: string; DEV?: boolean } }).env; const configuredOrigin = env?.VITE_DESK_APP_URL?.replace(/\/$/, ''); const origin = configuredOrigin || (env?.DEV ? 'http://localhost:5173' : ''); location.href = `${origin}/?mode=work`; }, emit: e => console.debug('[play]', e.type, e.view) }; }
  private switching = false;
  async switchTo(id: PlayViewId) {
    if (this.current?.id === id || this.switching) return;
    const next = this.views.get(id)!, prev = this.current, from = prev?.id, ctx = this.context();
    this.switching = true;
    next.prepare?.(ctx); // synchronous: still inside the user's tap (iOS motion + camera prompts need it)
    ctx.emit?.({ type: 'view.entering', view: id });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.root.classList.add('play-transition');
    try {
      if (!reduced) await new Promise(resolve => setTimeout(resolve, 250));
      if (prev) { const state = snapshotEngine(this.session, this.engine); this.session.position = state.position; this.session.heading = state.heading; await prev.exit(); }
      try {
        await next.enter(ctx, from);
        this.current = next;
        this.session.lastView = id;
        ctx.emit?.({ type: 'view.entered', view: id });
      } catch (err) {
        // e.g. the camera could not start: cancel the transition and keep the previous view (never a black screen)
        await next.exit();
        ctx.emit?.({ type: 'view.error', view: id, code: (err as { code?: ShellErrorCode }).code ?? 'asset_failed', message: (err as Error).message });
        this.notice(id === 'camera' ? `Camera unavailable: ${(err as Error).message}` : `Could not open ${id}.`);
        if (!prev) throw err;
        await prev.enter(ctx, id);
        this.current = prev;
      }
      if (!reduced) await new Promise(resolve => setTimeout(resolve, 250));
    } finally { this.root.classList.remove('play-transition'); this.switching = false; }
  }

  // Driven by the engine's own loop (renderer.setAnimationLoop), so the same callback runs inside a WebXR session.
  private frame = (time = 0, xrFrame?: XRFrame) => { const t = time || performance.now() / 1000; const dt = Math.min(.1, this.last ? t - this.last : .016); this.last = t; this.current?.update(dt, xrFrame); this.current?.resize(innerWidth, innerHeight); };
  private notice(text: string) { const n = document.createElement('div'); n.className = 'play-notice'; n.textContent = text; this.root.appendChild(n); window.setTimeout(() => n.remove(), 4200); }
  loop() { this.engine.onFrame = (t, frame) => this.frame(t, frame); }
  dispose() { this.engine.onFrame = undefined; void this.current?.exit(); this.engine.dispose(); }
}
