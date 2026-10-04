// play.md Part B (B.2-B.8): the Snapchat-style camera view. Live video fills the screen, the engine canvas is
// stacked on top (transparent), and the phone's orientation drives the 3D camera so the dog stays put in the room.
import * as THREE from 'three';
import { parseCommand, PushToTalk } from '../voice';
import type { PlayContext, PlayView, PlayViewId } from '../types';
import { Alive } from './lookat';
import { composite, deliver } from './capture';
import { PhonePose } from './pose';
import { CameraStream, StreamError } from './stream';
import { AmbientTint } from './tint';
import { CameraUi } from './ui';
import { XrTier, xrSupported } from './xr';

export const AR_PET_SCALE = 0.45;            // metres tall: a believable pet next to someone holding a phone
const SCALE_MIN = 0.25, SCALE_MAX = 2;       // pinch range (multiplier on AR_PET_SCALE)
const PLACE_MIN = 0.8, PLACE_MAX = 5;        // tap-to-place distance from the user (m)
const TAP_PX = 8, TAP_MS = 350, HOLD_MS = 600;
const CARRY_PX = 48;                         // a press on the dog that travels this far is a carry, not a stroke

export class CameraView implements PlayView {
  readonly id = 'camera' as const;
  private ctx!: PlayContext;
  private stream = new CameraStream();
  private pose!: PhonePose;
  private ui!: CameraUi;
  private alive!: Alive;
  private tint!: AmbientTint;
  private xr!: XrTier;
  private voice!: PushToTalk;
  private live = false;
  private entered = false;
  private frame?: XRFrame;
  // gesture state: pointers that did NOT start on the pet or on UI
  private pts = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; path: number }>();
  private pinch?: { dist: number; scale: number };
  private wasPinch = false;
  private holdTimer = 0;
  // a pointer that started on the pet (may turn into a carry)
  private petPtr?: { id: number; x0: number; y0: number; carrying: boolean };

  async enter(ctx: PlayContext, from?: PlayViewId) {
    this.ctx = ctx;
    const e = ctx.engine;
    if (!this.ui) {
      this.pose = new PhonePose(e.camera);
      this.alive = new Alive(e, this.pose, () => this.inViewGround());
      this.tint = new AmbientTint(this.stream.video, e);
      this.xr = new XrTier(e, ctx.root, () => this.xrEnded());
      this.voice = new PushToTalk(t => this.heard(t), code => this.ui.toast(code === 'not-allowed' ? 'Microphone access is blocked.' : 'Did not catch that.'));
      this.ui = new CameraUi({
        back: () => ctx.switchTo('room'),
        flip: () => void this.stream.flip().catch(err => this.fail(err)),
        recenter: () => this.recenter(),
        treat: () => { if (e.feed()) this.alive.focus(2); },
        ball: () => e.doIntent('fetch_ball'),
        micDown: () => { e.setListening(true); this.alive.focus(6); this.voice.start(); },
        micUp: () => { e.setListening(false); this.voice.stop(); },
        ar: () => void this.toggleXr(),
        capture: () => void this.capture(),
      });
      this.ui.micEnabled(this.voice.supported);
      void xrSupported().then(ok => this.ui.showAr(ok));
      // Tap on the dog: the engine plays the affectionate "tap" reaction; here it also turns its head to the user.
      e.on('POKE', () => { if (this.entered) this.alive.focus(3); });
      e.on('PET_STROKE', () => { if (this.entered) this.alive.focus(1.5); });
    }
    this.entered = true;
    ctx.background.appendChild(this.stream.video); // video under the transparent engine canvas
    ctx.root.appendChild(this.ui.el);
    e.setView('camera', { petScale: AR_PET_SCALE * ctx.session.scale });
    e.placePet(ctx.session.position.x, ctx.session.position.z, false);
    this.pose.update(0);
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    // iOS only grants motion access inside a tap. Coming from the Room's camera button we are inside one;
    // on a cold open we are not, so ask for a tap first.
    const needsTap = !from && typeof (window.DeviceOrientationEvent as { requestPermission?: unknown } | undefined)?.requestPermission === 'function';
    if (needsTap) this.ui.prompt('Your dog is waiting in the camera.', [{ label: 'Open camera', primary: true, run: () => void this.begin() }]);
    else await this.begin(!!from); // from another view: a camera failure rejects so the shell keeps that view (B.11)
  }

  private async begin(rethrow = false) {
    this.ui.clearPrompt();
    // Ask for motion first: it must be the first await in the tap on iOS.
    const orient = await this.pose.start();
    try {
      await this.stream.start();
    } catch (err) {
      if (rethrow) throw err instanceof StreamError ? err : new StreamError('camera_unavailable', String(err));
      this.fail(err); return;
    }
    this.live = true;
    this.pose.recenter();
    this.alive.enter(); // greeting: faces the user, wags
    if (orient === 'denied') {
      this.ctx.emit({ type: 'view.error', view: 'camera', code: 'orientation_denied', message: 'Motion access denied' });
      this.ui.toast('Motion access is off, so turning the phone will not move the dog.', 6000);
    } else if (orient === 'mouse' || orient === 'unavailable') {
      this.ui.toast(orient === 'mouse' ? 'Drag to look around (simulated motion).' : 'No motion sensor here. Drag to look around.');
    } else this.ui.toast('Move your phone. Tap the floor to place your dog.');
    this.ui.coach(); // first run only
  }

  // ---------- capture (B.9) ----------
  private async capture() {
    if (!this.live) return;
    if (this.xr.active) { this.ui.toast('Capture is not available in True AR yet.'); return; }
    try {
      const blob = await composite(this.stream.video, this.ctx.canvas, this.ctx.engine, this.stream.video.classList.contains('mirrored'));
      this.lastCapture = blob;
      this.ui.shutter(URL.createObjectURL(blob));
      const how = await deliver(blob);
      if (how !== 'cancelled') this.ui.toast(how === 'shared' ? 'Shared.' : 'Photo saved.', 1800);
    } catch (err) {
      console.warn('capture failed', err);
      this.ui.toast('Could not take the photo.');
    }
  }
  /** Most recent capture (tests and the thumbnail). */
  lastCapture?: Blob;

  private fail(err: unknown) {
    const e = err instanceof StreamError ? err : new StreamError('camera_unavailable', String(err));
    this.live = false;
    this.ctx.emit({ type: 'view.error', view: 'camera', code: e.code, message: e.message });
    this.ui.prompt(e.code === 'camera_denied' ? 'Camera access is blocked. Allow it in your browser settings, then try again.' : e.message, [
      { label: 'Try again', primary: true, run: () => void this.begin() },
      { label: 'Back', run: () => this.ctx.switchTo('room') },
    ]);
  }

  exit() {
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    clearTimeout(this.holdTimer);
    this.pts.clear(); this.pinch = undefined; this.petPtr = undefined;
    if (this.xr.active) this.xr.stop();
    this.voice.abort();
    this.ctx.engine.setListening(false);
    this.stream.stop();               // camera light off
    this.pose.stop();
    this.alive.exit();
    this.tint.reset();
    this.stream.video.remove();
    this.ui.el.remove();
    this.live = this.entered = false;
    const p = this.ctx.engine.petPosition; // hand the pet's place back to the session
    this.ctx.session.position = { x: p.x, z: p.z };
  }

  update(dt: number, frame?: XRFrame) {
    this.frame = frame;
    if (this.xr.active) this.xr.update(frame); // the XR session owns the camera pose
    else this.pose.update(dt);
    if (!this.live) return;
    this.alive.update(dt, !this.xr.active && !this.pose.simulated);
    if (!this.xr.active) this.tint.update(dt);
  }
  resize() { /* engine resizes its canvas; video is CSS object-fit: cover */ }

  private recenter() {
    if (this.xr.active) { const g = this.inViewGround(); if (g) this.ctx.engine.placePet(g.x, g.z, false); }
    else { this.pose.recenter(); this.ctx.engine.placePet(0, 0, false); } // dog back in front of the user
    this.alive.focus(2);
    this.ui.toast('Recentered.');
  }

  // ---------- voice (B.7): push-to-talk -> local intents ----------
  private heard(text: string) {
    const c = parseCommand(text), e = this.ctx.engine;
    if (!c) { this.ui.toast(`"${text}" - try sit, spin, dance, roll over...`); return; }
    this.alive.focus(2.5);
    if (c.kind === 'intent') e.doIntent(c.intent);
    else if (c.kind === 'praise') e.react('tap');
    else e.feed();
    this.ui.toast(`"${text}"`, 1800); // caption of what was heard
  }

  // ---------- WebXR tier (B.5) ----------
  private async toggleXr() {
    if (this.xr.active) { this.xr.stop(); return; }
    try {
      this.stream.stop(); // the XR session shows the camera itself
      this.tint.reset();
      await this.xr.start();
      this.ui.setAr(true);
      this.ui.toast('Point at the floor to place your dog.', 5000);
    } catch (err) {
      console.warn('WebXR failed, staying on gyro tier', err);
      this.ui.toast('True AR is not available. Using motion tracking.');
      void this.stream.start().catch(e => this.fail(e));
    }
  }
  private xrEnded() {
    this.ui.setAr(false);
    if (!this.entered) return;
    this.ctx.engine.placePet(0, 0, false);
    this.pose.recenter();
    void this.stream.start().catch(e => this.fail(e)); // back to the gyro tier without a reload
  }

  // ---------- gestures: tap-to-place, carry the dog, pinch-to-scale, long-press recenter, simulated look ----------
  private onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('[data-ui]')) return; // controls
    this.ui.dismissCoach();
    if (this.ctx.engine.hitTest(e.clientX, e.clientY)) {
      // the pet: engine Interactions own stroke and tap; we only watch for a carry
      this.petPtr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, carrying: false };
      return;
    }
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, path: 0 });
    clearTimeout(this.holdTimer);
    if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: this.ctx.session.scale };
      this.wasPinch = true;
    } else if (this.pts.size === 1) {
      this.wasPinch = false;
      this.holdTimer = window.setTimeout(() => { const p = this.pts.get(e.pointerId); if (p && p.path < TAP_PX) { p.path = Infinity; this.recenter(); } }, HOLD_MS);
    }
  };

  private onMove = (e: PointerEvent) => {
    const pp = this.petPtr;
    if (pp && pp.id === e.pointerId) {
      if (!pp.carrying && Math.hypot(e.clientX - pp.x0, e.clientY - pp.y0) > CARRY_PX) pp.carrying = true;
      if (pp.carrying) this.place(e.clientX, e.clientY); // the dog follows the finger along the floor
      return;
    }
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.path += Math.hypot(dx, dy); p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      const s = THREE.MathUtils.clamp(this.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.dist), SCALE_MIN, SCALE_MAX);
      this.ctx.session.scale = s;
      this.ctx.engine.setPetScale(AR_PET_SCALE * s);
    } else if (this.pts.size === 1 && p.path > TAP_PX && this.pose.simulated && !this.xr.active) {
      this.pose.look(dx, dy); // no gyro: drag stands in for turning the phone
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.petPtr?.id === e.pointerId) { this.petPtr = undefined; return; } // dropped: it walks the rest of the way and settles
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    this.pts.delete(e.pointerId);
    clearTimeout(this.holdTimer);
    if (this.pts.size < 2) this.pinch = undefined;
    if (e.type === 'pointercancel' || this.wasPinch || p.path >= TAP_PX || e.timeStamp - p.t0 > TAP_MS) return;
    this.place(e.clientX, e.clientY);
  };

  /** Floor point under a screen position, clamped to a sane distance from the user's feet. */
  private groundAt(px: number, py: number): THREE.Vector3 | undefined {
    const e = this.ctx.engine, g = e.groundPoint(px, py);
    if (!g) return undefined; // above the horizon
    const foot = new THREE.Vector3(e.camera.position.x, g.y, e.camera.position.z); // the user's feet under the camera
    const d = g.clone().sub(foot);
    const len = d.length();
    if (len < 1e-3) return undefined;
    return foot.add(d.setLength(THREE.MathUtils.clamp(len, PLACE_MIN, PLACE_MAX)));
  }

  /** Tap or drag on the floor: the dog walks to that spot. */
  private place(px: number, py: number) {
    if (!this.live) return;
    const g = this.groundAt(px, py);
    if (g) this.ctx.engine.placePet(g.x, g.z, true);
  }

  /** A floor point comfortably inside the current view (lower-middle of the screen). */
  private inViewGround() {
    return (this.xr.active && this.xr.centreHit(this.frame)) || this.groundAt(innerWidth / 2, innerHeight * 0.72);
  }
}
