// Camera view chrome (play.md B.2/B.7/B.10): edge controls only, the middle of the screen stays free.

export interface CameraUiHandlers {
  back(): void; flip(): void; recenter(): void; treat(): void; ball(): void;
  micDown(): void; micUp(): void;
  /** Toggle true AR (WebXR). Only offered when the device supports it. */
  ar(): void;
  capture(): void;
}

export class CameraUi {
  readonly el = document.createElement('div');
  private toastEl = document.createElement('div');
  private card = document.createElement('div');
  private chips = document.createElement('div');
  private mic: HTMLButtonElement;
  private arChip: HTMLButtonElement;
  private toastTimer = 0;
  private flash = document.createElement('div');
  private thumb = document.createElement('img');
  private coachEl = document.createElement('div');
  private coachTimer = 0;

  constructor(h: CameraUiHandlers) {
    this.el.className = 'cam-ui';
    const btn = (parent: HTMLElement, cls: string, label: string, text: string, fn?: () => void) => {
      const b = document.createElement('button');
      b.className = cls; b.type = 'button'; b.textContent = text;
      b.setAttribute('aria-label', label); b.dataset.ui = '1';
      if (fn) b.addEventListener('click', fn);
      parent.appendChild(b);
      return b;
    };
    btn(this.el, 'cam-btn tl', 'Back', '‹', h.back);
    btn(this.el, 'cam-btn tr', 'Switch camera', '⇄', h.flip);

    // mic: hold to talk (pointer events so it works for touch and mouse; Space/Enter for keyboard)
    this.mic = btn(this.el, 'cam-btn bl', 'Hold to talk to your dog', '🎤');
    const down = (e: Event) => { e.preventDefault(); this.mic.classList.add('on'); h.micDown(); };
    const up = () => { if (!this.mic.classList.contains('on')) return; this.mic.classList.remove('on'); h.micUp(); };
    this.mic.addEventListener('pointerdown', down);
    this.mic.addEventListener('pointerup', up); this.mic.addEventListener('pointerleave', up); this.mic.addEventListener('pointercancel', up);
    this.mic.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
    this.mic.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); });

    // "more": one chip that expands the quick actions
    const more = btn(this.el, 'cam-btn br', 'More actions', '⋯', () => {
      const open = this.chips.hidden;
      this.chips.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
    });
    more.setAttribute('aria-expanded', 'false');
    this.chips.className = 'cam-chips'; this.chips.dataset.ui = '1'; this.chips.hidden = true;
    btn(this.chips, 'cam-chip', 'Give a treat', 'Treat', h.treat);
    btn(this.chips, 'cam-chip', 'Throw the ball', 'Ball', h.ball);
    btn(this.chips, 'cam-chip', 'Recenter the dog in front of you', 'Recenter', h.recenter);
    this.arChip = btn(this.chips, 'cam-chip', 'Toggle true AR', 'True AR', h.ar);
    this.arChip.hidden = true;

    // capture: the one large control, bottom centre
    btn(this.el, 'cam-shutter', 'Take a photo', '', h.capture);
    this.flash.className = 'cam-flash';
    this.thumb.className = 'cam-thumb'; this.thumb.alt = 'Last photo'; this.thumb.hidden = true;
    this.coachEl.className = 'cam-coach'; this.coachEl.hidden = true;
    this.coachEl.innerHTML = '<p>Move your phone. Your dog is here.</p><p class="tip">Tap the floor to place it <span aria-hidden="true">↓</span></p>';
    this.el.append(this.flash, this.thumb, this.coachEl);

    this.toastEl.className = 'cam-toast'; this.toastEl.setAttribute('role', 'status');
    this.card.className = 'cam-card'; this.card.dataset.ui = '1'; this.card.hidden = true;
    this.el.append(this.chips, this.toastEl, this.card);
  }

  showAr(supported: boolean) { this.arChip.hidden = !supported; }
  setAr(on: boolean) { this.arChip.textContent = on ? 'Exit AR' : 'True AR'; }
  micEnabled(on: boolean) { this.mic.disabled = !on; this.mic.title = on ? '' : 'Voice is not supported in this browser'; }

  /** Shutter feedback: a brief flash and a thumbnail of the photo. */
  shutter(url: string) {
    this.flash.classList.remove('go');
    void this.flash.offsetWidth; // restart the animation
    this.flash.classList.add('go');
    if (this.thumb.src.startsWith('blob:')) URL.revokeObjectURL(this.thumb.src);
    this.thumb.src = url; this.thumb.hidden = false;
  }

  /** First-run coach mark (once per browser). Dismissed by the first touch or after a few seconds. */
  coach() {
    try { if (localStorage.getItem('fetch.play.coach')) return; localStorage.setItem('fetch.play.coach', '1'); } catch { /* private mode: show it every time */ }
    this.coachEl.hidden = false;
    this.coachTimer = window.setTimeout(() => this.dismissCoach(), 7000);
  }
  dismissCoach() { clearTimeout(this.coachTimer); this.coachEl.hidden = true; }

  toast(text: string, ms = 3500) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Blocking prompt (start / permission denied / unavailable): one line and up to two buttons. */
  prompt(text: string, actions: { label: string; primary?: boolean; run(): void }[]) {
    this.card.replaceChildren();
    const p = document.createElement('p');
    p.textContent = text;
    this.card.appendChild(p);
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a.label; b.className = a.primary ? 'primary' : '';
      b.addEventListener('click', () => a.run());
      this.card.appendChild(b);
    }
    this.card.hidden = false;
  }
  clearPrompt() { this.card.hidden = true; }
}
