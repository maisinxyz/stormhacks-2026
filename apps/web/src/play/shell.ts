// Play shell (play.md Part 0): owns the single engine + pet and switches between views.
import type { PetBundle } from '@fetch/contracts';
import { Engine } from '../engine';
import type { PetSession, PlayContext, PlayView, PlayViewId, ShellErrorCode, ShellEvent } from './types';

const FALLBACK_PET = 'dog';

async function loadBundle(pet: string | null): Promise<{ bundle: PetBundle; fellBack: boolean }> {
  // ponytail: ?pet= is a /public/bundles folder name today; switch to GET /pets/:id when real generated pets exist.
  for (const id of [pet, FALLBACK_PET]) {
    if (!id || !/^[\w-]+$/.test(id)) continue;
    const r = await fetch(`/bundles/${id}/bundle.json`).catch(() => undefined);
    if (r?.ok && r.headers.get('content-type')?.includes('json')) return { bundle: await r.json(), fellBack: id !== pet };
  }
  throw new Error('no pet bundle available');
}

export class PlayShell {
  readonly engine = new Engine();
  private views = new Map<PlayViewId, PlayView>();
  private active?: PlayView;
  private switching = false;
  private ctx!: PlayContext;
  private listeners: ((e: ShellEvent) => void)[] = [];
  private bg = document.createElement('div');
  private curtain = document.createElement('div');

  constructor(private stage: HTMLElement, private canvas: HTMLCanvasElement, private root: HTMLElement) {}

  register(v: PlayView) { this.views.set(v.id, v); return this; }
  on(cb: (e: ShellEvent) => void) { this.listeners.push(cb); }
  get view() { return this.active?.id; }

  async start(first: PlayViewId) {
    const q = new URLSearchParams(location.search);
    const { bundle, fellBack } = await loadBundle(q.get('pet'));
    // layers, bottom to top: view background, curtain (fades the background only), engine canvas (the dog), UI
    this.bg.id = 'bg'; this.curtain.id = 'curtain';
    this.stage.insertBefore(this.curtain, this.canvas);
    this.stage.insertBefore(this.bg, this.curtain);
    const session: PetSession = { bundle, position: { x: 0, z: 0 }, heading: 0, scale: 1, quality: 'low', lastView: first };
    this.engine.mount(this.canvas, document.createElement('canvas')); // no edge-peek in Play
    await this.engine.loadPet(bundle);
    this.engine.setMode('play');
    this.engine.setQuality(session.quality); // phone default (play.md 0.4)
    this.ctx = {
      engine: this.engine, session, stage: this.stage, background: this.bg, root: this.root, canvas: this.canvas,
      switchTo: v => void this.switchTo(v),
      exit: () => { location.href = q.get('back') ?? '/'; },
      emit: e => this.listeners.forEach(cb => cb(e)),
    };
    let last = 0;
    this.engine.onFrame = (t, frame) => { const dt = Math.min(0.1, t - last); last = t; this.active?.update(dt, frame); };
    window.addEventListener('resize', () => this.active?.resize(innerWidth, innerHeight));
    if (fellBack && q.get('pet')) console.warn(`pet "${q.get('pet')}" not found, using ${FALLBACK_PET}`);
    await this.switchTo(this.views.has(first) ? first : [...this.views.keys()][0]);
    return { fellBack };
  }

  async switchTo(id: PlayViewId) {
    const next = this.views.get(id);
    if (!next) { this.ctx.exit(); return; } // view not built yet (e.g. Room): leave Play
    if (this.switching || next === this.active) return;
    this.switching = true;
    const prev = this.active, from = prev?.id;
    this.ctx.emit({ type: 'view.entering', view: id });
    try {
      await this.fade(true);       // old background fades out; the dog stays rendered on top throughout
      await prev?.exit();
      this.active = undefined;
      try {
        await next.enter(this.ctx, from);
        this.active = next;
      } catch (err) {
        // e.g. the camera could not start: cancel the transition and keep the previous view (never a black screen)
        await next.exit();
        this.ctx.emit({ type: 'view.error', view: id, code: (err as { code?: ShellErrorCode }).code ?? 'asset_failed', message: (err as Error).message });
        if (!prev) throw err;
        await prev.enter(this.ctx, id);
        this.active = prev;
        return;
      }
      this.ctx.session.lastView = id;
      this.ctx.emit({ type: 'view.entered', view: id });
    } finally { await this.fade(false); this.switching = false; }
  }

  // ~0.5 s crossfade in total; a cut when the user prefers reduced motion.
  private fade(dark: boolean) {
    const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.curtain.style.transition = instant ? 'none' : 'opacity .25s';
    this.curtain.style.opacity = dark ? '1' : '0';
    return new Promise<void>(r => setTimeout(r, instant ? 0 : 260));
  }
}
