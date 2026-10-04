// Play room HUD: edge controls, hotbar, hearts, and the voice pill / toast / command list.
// The voice pill, toast, bubble and command list reuse the camera view's styles (cam-* in camera/camera.css, same bundle).
import { COMMANDS } from '../commands';
import type { VoiceState } from '../voice';

export const ITEMS = [
  { id: 'hand', icon: '✋', label: 'Hand' },
  { id: 'ball', icon: '🎾', label: 'Ball' },
  { id: 'frisbee', icon: '🥏', label: 'Frisbee' },
  { id: 'food', icon: '🍖', label: 'Food' },
] as const;
export type ItemId = typeof ITEMS[number]['id'];

export interface HudHandlers {
  back(): void; camera(): void; mic(): void;
  /** The on-screen action button (phones): pressed / released. */
  use(down: boolean): void;
  pick(item: ItemId): void;
  /** Any panel opened: the game should give the mouse back. */
  panel(): void;
}

export class RoomHud {
  readonly el = document.createElement('div');
  private q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
  private toastTimer = 0;

  constructor(private h: HudHandlers, touch: boolean) {
    const el = this.el;
    el.className = 'room-ui';
    el.innerHTML = `<div class="room-top"><button class="room-work-button" data-action="back" aria-label="Back to Work dashboard">‹ <span>Back to Work</span></button><div class="room-title"><span class="room-eyebrow" data-owner></span><strong>Play room</strong></div><div class="room-top-right"><button data-action="help" aria-label="What can I say to my pet?" class="room-info">i</button><button data-action="camera" aria-label="Open camera">◎</button></div></div>`
      + `<div class="room-stats" aria-live="polite"><span class="room-hearts" data-hearts role="img"></span><span class="room-count" data-count></span></div>`
      + `<div class="room-cross" aria-hidden="true"></div><div class="room-charge" aria-hidden="true"><i></i></div>`
      + `<div class="room-hotbar" role="toolbar" aria-label="Held item">${ITEMS.map((it, i) => `<button data-item="${it.id}" aria-label="${it.label}" aria-pressed="false">${it.icon}<small>${touch ? it.label : i + 1}</small></button>`).join('')}</div>`
      + `<button class="room-mic" data-action="mic" aria-label="Talk to your pet: tap to start, tap again to stop">🎤<small>${touch ? 'Talk' : 'U'}</small></button>`
      + (touch ? `<button class="room-use" data-action="use" aria-label="Use the held item: hold to throw harder">Pet</button>` : '')
      + `<div class="cam-voice" role="status" hidden></div><div class="cam-toast" role="status"></div>`
      + `<div class="room-coach hide" data-coach></div>`
      + `<div class="cam-help" data-ui="1" role="dialog" aria-label="Voice commands" hidden><h2>Say it to your pet</h2><p class="hint">Tap the mic${touch ? '' : ' (or press U)'}, then speak. It picks the closest command, so you do not need the exact words. Anything else gets a wag and hearts.</p><ul>${COMMANDS.filter(c => c.id !== 'stand').map(c => `<li>${c.label}</li>`).join('')}</ul><button type="button" class="primary" data-action="help-close">Got it</button></div>`;
    const on = (action: string, fn: () => void) => this.q(`[data-action="${action}"]`).addEventListener('click', fn);
    on('back', h.back); on('camera', h.camera); on('mic', h.mic);
    on('help', () => this.help(this.q('.cam-help').hidden)); on('help-close', () => this.help(false));
    el.querySelectorAll<HTMLButtonElement>('[data-item]').forEach(b => b.addEventListener('click', () => h.pick(b.dataset.item as ItemId)));
    const use = el.querySelector<HTMLButtonElement>('[data-action="use"]');
    if (use) {
      let down = false;
      const set = (d: boolean) => (ev: Event) => { ev.preventDefault(); if (down !== d) { down = d; h.use(d); } };
      use.addEventListener('pointerdown', set(true)); use.addEventListener('pointerup', set(false)); use.addEventListener('pointercancel', set(false)); use.addEventListener('pointerleave', set(false));
    }
  }

  owner(name: string) { this.q('[data-owner]').textContent = `${name}'s place`; }
  item(id: ItemId) {
    this.el.querySelectorAll<HTMLButtonElement>('[data-item]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.item === id)));
    const use = this.el.querySelector('[data-action="use"]');
    if (use) use.textContent = id === 'hand' ? 'Pet' : id === 'food' ? 'Feed' : 'Throw';
  }
  /** The crosshair is on something the main button will act on. */
  aim(on: boolean) { this.q('.room-cross').classList.toggle('hot', on); }
  /** Throw power 0..1 under the crosshair (0 hides it). */
  charge(v: number) { const c = this.q('.room-charge'); c.classList.toggle('on', v > 0); (c.firstElementChild as HTMLElement).style.width = `${Math.round(v * 100)}%`; }
  /** Happiness 0..100 as five hearts. */
  hearts(happiness: number) {
    const n = Math.round(Math.max(0, Math.min(100, happiness)) / 20), el = this.q('[data-hearts]');
    const text = '♥'.repeat(n) + '♡'.repeat(5 - n);
    if (el.textContent !== text) { el.textContent = text; el.setAttribute('aria-label', `Happiness ${n} of 5`); }
  }
  counts(fetches: number, tricks: number) { this.q('[data-count]').textContent = `🎾 ${fetches}  ✨ ${tricks}`; }
  help(open: boolean) { this.q('.cam-help').hidden = !open; if (open) this.h.panel(); }
  /** A hint line above the hotbar; empty text hides it. */
  coach(text: string) { const c = this.q('[data-coach]'); if (text) c.textContent = text; c.classList.toggle('hide', !text); }

  setVoice(state: VoiceState) {
    const mic = this.q('[data-action="mic"]'), pill = this.q('.cam-voice');
    mic.classList.toggle('on', state === 'listening'); mic.classList.toggle('busy', state === 'interpreting');
    pill.hidden = state === 'idle'; pill.dataset.state = state;
    pill.textContent = state === 'listening' ? 'Listening' : 'Interpreting';
    if (state === 'idle') mic.style.removeProperty('--lvl');
  }
  micLevel(v: number) { this.q('[data-action="mic"]').style.setProperty('--lvl', v.toFixed(2)); }
  micEnabled(on: boolean) { const m = this.q<HTMLButtonElement>('[data-action="mic"]'); m.disabled = !on; m.title = on ? '' : 'Voice is not supported in this browser'; }
  toast(text: string, ms = 3500) {
    const t = this.q('.cam-toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }
  /** A short speech bubble at a screen point (the "Woof!"). */
  bubble(text: string, x: number, y: number) {
    const b = document.createElement('div');
    b.className = 'cam-bubble'; b.textContent = text;
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    this.el.appendChild(b);
    window.setTimeout(() => b.remove(), 950);
  }
}
