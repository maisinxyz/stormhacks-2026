// play.md Part B (B.2-B.8): the Snapchat-style camera view. Live video fills the screen, the engine canvas is
// stacked on top (transparent), and the phone's orientation drives the 3D camera so the dog stays put in the room.
import * as THREE from 'three';
import { parseCommand, PushToTalk } from '../voice';
import type { OrientationStatus } from './pose';
import type { LocalIntent } from '@fetch/contracts';
import type { PlayContext, PlayView, PlayViewId } from '../types';
import { plushFromPhoto } from '../../engine/sdf/fromPhoto';
import { Alive } from './lookat';
import './camera.css';
import { composite, deliver } from './capture';
import { CAMERA_FOV, PhonePose, START_DISTANCE } from './pose';
import { CameraStream, StreamError } from './stream';
import { AmbientTint } from './tint';
import { CameraUi } from './ui';
import { XrTier, xrSupported } from './xr';

export const AR_PET_SCALE = 0.9;             // metres tall: large-dog size, so it fills about a third of a phone screen at 2 m
const SCALE_MIN = 0.25, SCALE_MAX = 2;       // pinch range (multiplier on AR_PET_SCALE)
const PLACE_MIN = 0.8, PLACE_MAX = 5;        // tap-to-place distance from the user (m)
const TAP_PX = 8, TAP_MS = 350, HOLD_MS = 600;
// Web Speech error codes -> what the user can do about it (anything else shows the raw code)
const VOICE_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser, or use the command buttons under ⋯.',
  'service-not-allowed': 'This browser blocks speech recognition. Use the command buttons under ⋯.',
  'audio-capture': 'No microphone found. Use the command buttons under ⋯.',
  network: 'Speech recognition could not reach its service (needs Chrome or Safari, online). Use the command buttons under ⋯.',
  'no-speech': 'Did not hear anything. Tap the mic, then speak.',
  'model-unavailable': 'The voice model could not be downloaded (needs internet once). Use the command buttons under ⋯.',
};
const LOOK_AROUND = new URLSearchParams(location.search).get('orient') === 'mouse';
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
  /** Pinch multiplier on AR_PET_SCALE. (session.scale is the Room's pet size in the shared shell, not ours.) */
  private zoom = 1;
  /** "Follow": the dog walks to stay in front of the user as they turn. Any other command ends it. */
  private following = false;
  /** Which side of the shot the dog stands on (+1 right, -1 left). Remembered for the session. */
  private side: 1 | -1 = (() => { try { return sessionStorage.getItem('fetch.play.side') === '-1' ? -1 : 1; } catch { return 1; } })();
  private entered = false;
  private frame?: XRFrame;
  // gesture state: pointers that did NOT start on the pet or on UI
  private pts = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; path: number }>();
  private pinch?: { dist: number; scale: number };
  private wasPinch = false;
  private holdTimer = 0;
  // a pointer that started on the pet (may turn into a carry)
  private petPtr?: { id: number; x0: number; y0: number; carrying: boolean; last?: THREE.Vector3 };

  private pending?: { orient: Promise<OrientationStatus>; cam: Promise<void> };

  /** Shell calls this synchronously inside the user's tap, before any await: iOS motion permission and the camera
   *  prompt both need that gesture, and the shell's own transition delay would otherwise lose it. */
  prepare(ctx: PlayContext) {
    this.init(ctx);
    const orient = this.pose.start();
    const cam = this.stream.start();
    cam.catch(() => { /* surfaced when begin() awaits it */ });
    this.pending = { orient, cam };
  }

  private init(ctx: PlayContext) {
    this.ctx = ctx;
    const e = ctx.engine;
    if (!this.ui) {
      this.pose = new PhonePose(e.camera);
      this.alive = new Alive(e);
      this.tint = new AmbientTint(this.stream.video, e);
      this.xr = new XrTier(e, ctx.root, () => this.xrEnded());
      this.voice = new PushToTalk(t => this.heard(t), code => this.ui.toast(VOICE_ERRORS[code] ?? `Voice error (${code}). Use the command buttons under ⋯.`, 6000), text => this.ui.toast(text, 4000), s => this.voiceState(s));
      this.ui = new CameraUi({
        back: () => ctx.switchTo('room'),
        flip: () => void this.stream.flip().catch(err => this.fail(err)),
        recenter: () => this.recenter(),
        treat: () => { if (e.feed()) this.alive.focus(2); },
        ball: () => e.doIntent('fetch_ball'),
        command: i => { this.following = false; this.alive.focus(2.5); e.doIntent(i); },
        follow: () => this.follow(),
        swap: () => this.swapSide(),
        photo: f => void this.usePhoto(f),
        mic: () => this.voice.toggle(),
        ar: () => void this.toggleXr(),
        capture: () => void this.capture(),
      });
      this.ui.micEnabled(this.voice.supported);
      void xrSupported().then(ok => this.ui.showAr(ok));
      // Tap on the dog: the engine plays the affectionate "tap" reaction; here it also turns its head to the user.
      e.on('POKE', () => { if (this.entered) { this.alive.focus(3); this.hearts(); } });
      e.on('PET_STROKE', () => { if (this.entered) { this.alive.focus(1.5); this.hearts(); } });
    }
  }

  async enter(ctx: PlayContext, from?: PlayViewId) {
    this.init(ctx);
    const e = ctx.engine;
    this.entered = true;
    ctx.root.insertBefore(this.stream.video, ctx.canvas); // video under the transparent engine canvas
    ctx.root.appendChild(this.ui.el);
    e.setView('camera', { petScale: AR_PET_SCALE * this.zoom });
    e.setExternalCamera(true);       // this view owns the 3D camera (gyro pose)
    e.setOverlayScene(null);         // no room geometry
    e.setFurnitureSpots([]);
    e.setAutonomous(false);          // the dog only moves on a command here (voice, chips, tap, drag)
    e.setSplatDepthTest(false);      // no real depth in AR: the dog always draws over the video
    e.setGroundPlane(0);
    this.placeSide(false);           // the dog starts at the side of the view, clear of the user
    // Prefer portrait. Browsers only allow the lock in fullscreen / installed apps, so a refusal is expected and fine:
    // PhonePose reads the live screen angle on every sensor event, so landscape still tracks correctly.
    void (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> } | undefined)?.lock?.('portrait').catch(() => { /* not allowed here */ });
    this.pose.update(0);
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    // iOS only grants motion access inside a tap. Coming from the Room's camera button we are inside one;
    // on a cold open we are not, so ask for a tap first.
    const needsTap = !this.pending && typeof (window.DeviceOrientationEvent as { requestPermission?: unknown } | undefined)?.requestPermission === 'function';
    if (needsTap) this.ui.prompt('Your dog is waiting in the camera.', [{ label: 'Open camera', primary: true, run: () => void this.begin() }]);
    else await this.begin(!!from); // from another view: a camera failure rejects so the shell keeps that view (B.11)
  }

  private async begin(rethrow = false) {
    this.ui.clearPrompt();
    // Started inside the tap by prepare() when we come from the Room; otherwise start them now (the tap prompt calls us).
    const p = this.pending ?? { orient: this.pose.start(), cam: this.stream.start() };
    this.pending = undefined;
    const orient = await p.orient;
    try {
      await p.cam;
    } catch (err) {
      if (rethrow) throw err instanceof StreamError ? err : new StreamError('camera_unavailable', String(err));
      this.fail(err); return;
    }
    this.live = true;
    this.pose.recenter();
    this.alive.enter(); // greeting: faces the user, wags
    this.ctx.engine.flourish('sparkle'); // it appears with a soft sparkle
    if (orient === 'denied') {
      this.ctx.emit?.({ type: 'view.error', view: 'camera', code: 'orientation_denied', message: 'Motion access denied' });
      this.ui.toast('Motion access is off, so turning the phone will not move the dog.', 6000);
    } else if (orient === 'mouse' || orient === 'unavailable') {
      if (orient === 'mouse') this.ui.toast('Drag to look around (simulated motion).');
    } else this.ui.toast('Move your phone. Tap the floor to place your dog.');
    this.ui.coach(); // first run only
    this.voice.warm();
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
    this.ctx.emit?.({ type: 'view.error', view: 'camera', code: e.code, message: e.message });
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
    try { screen.orientation?.unlock?.(); } catch { /* was never locked */ }
    this.voice.release(); // mic off
    this.ctx.engine.setListening(false);
    this.ctx.engine.setAutonomous(true); // the Room keeps its own idle life
    this.stream.stop();               // camera light off
    this.pose.stop();
    this.alive.exit();
    this.tint.reset();
    this.stream.video.remove();
    this.ui.el.remove();
    this.live = this.entered = this.following = false;
    this.pending = undefined;
  }

  update(dt: number, frame?: XRFrame) {
    this.frame = frame;
    if (this.xr.active) this.xr.update(frame); // the XR session owns the camera pose
    else this.pose.update(dt);
    if (!this.live) return;
    this.alive.update(dt);
    if (this.following) this.followStep();
    if (!this.xr.active) this.tint.update(dt);
  }
  resize() { /* engine resizes its canvas; video is CSS object-fit: cover */ }

  /** Default spot: the outer side of the view, so the dog does not cover the user. The spot is worked out from the
   *  screen: the dog is long and stands 3/4 on, so on a narrow portrait phone it only fits at the side if it stands
   *  farther back (or, failing that, smaller). It faces the centre. No face/body detection (phase 2, play.md B.14).
   *  ponytail: fixed side; it will not dodge if the user leans into it, they swap sides or drag it. */
  private placeSide(walk: boolean) {
    const e = this.ctx.engine, f = e.footprint, k = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * e.camera.aspect;
    const width = (s: number) => (f.y * 0.65 + f.x * 0.75) * s; // on-screen width of the dog at scale s (m), standing 3/4 on
    let s = AR_PET_SCALE * this.zoom, d = START_DISTANCE;
    while (d < PLACE_MAX && width(s) > 0.8 * d * k) d += 0.25;  // fit in the outer 40% of the frame
    if (width(s) > 0.8 * d * k) s = Math.max(AR_PET_SCALE * 0.5, 0.8 * d * k / width(1));
    this.zoom = s / AR_PET_SCALE; e.setPetScale(s);
    const half = d * k, x = this.side * (half - width(s) / 2 - 0.06 * half);
    e.placePet(x, START_DISTANCE - d, walk);
    e.facePet(-this.side as 1 | -1); // toward the centre (after the walk, if it is walking there)
  }

  private lastHearts = 0;
  /** Hearts float up when the dog is petted (at most every 0.7 s: strokes fire many events). */
  private hearts() { const t = performance.now(); if (t - this.lastHearts > 700) { this.lastHearts = t; this.ctx.engine.flourish('heart'); } }

  /** Upload a dog photo: the plush pet takes its coat colours from it (no server or AI quota needed).
   *  ponytail: colours only for now; the shape (ears, snout, build) stays the default plush dog. */
  private async usePhoto(file: File) {
    const e = this.ctx.engine, s = this.ctx.session;
    try {
      s.bundle = { ...s.bundle, id: `plush-${Date.now()}`, plush: await plushFromPhoto(file) as unknown as Record<string, unknown> };
      await e.loadPet(s.bundle);
      e.setQuality(s.quality); e.setAutonomous(false); e.setSplatDepthTest(false);
      this.placeSide(false);
      e.flourish('sparkle');
      this.alive.focus(3);
      this.ui.toast('Made a plush pet in the colours of your dog.', 4000);
    } catch (err) {
      console.warn('photo -> plush failed', err);
      this.ui.toast('Could not read that photo. Try another one.');
    }
  }

  /** The dog listens (head up, ears perked) from the moment the mic opens until it has a command, and the UI shows the stage. */
  private voiceState(s: 'idle' | 'listening' | 'interpreting') {
    this.ui.setVoice(s);
    this.ctx.engine.setListening(s !== 'idle');
    if (s !== 'idle') this.alive.focus(10);
    window.clearInterval(this.levelTimer);
    if (s === 'listening') this.levelTimer = window.setInterval(() => this.ui.micLevel(this.voice.micLevel), 60);
  }
  private levelTimer = 0;

  private swapSide() {
    this.following = false;
    this.side = -this.side as 1 | -1;
    try { sessionStorage.setItem('fetch.play.side', String(this.side)); } catch { /* private mode */ }
    this.placeSide(true);
    this.alive.focus(2);
  }

  private recenter() {
    this.following = false;
    if (this.xr.active) { const g = this.inViewGround(); if (g) this.ctx.engine.placePet(g.x, g.z, false); }
    else { this.pose.recenter(); this.placeSide(true); } // dog back to its spot at the side of the view
    this.alive.focus(2);
    this.ui.toast('Recentered.');
  }

  // ---------- voice (B.7): push-to-talk -> local intents ----------
  private heard(text: string) {
    const c = parseCommand(text), e = this.ctx.engine;
    if (!c) { this.ui.toast(`Heard "${text}". Try sit, stand, spin, dance, roll over...`, 5000); return; }
    this.alive.focus(2.5);
    this.following = false;
    if (c.kind === 'follow') this.follow();
    else if (c.kind === 'swap') this.swapSide();
    else if (c.kind === 'intent') e.doIntent(c.intent);
    else if (c.kind === 'praise') e.react('tap');
    else e.feed();
    this.ui.toast(`Heard "${text}"`, 2500); // caption of what was heard
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
    this.placeSide(false);
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
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: this.zoom };
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
      if (pp.carrying) { // the dog follows the finger along the floor
        const g = this.groundAt(e.clientX, e.clientY);
        if (g) { pp.last = g; this.ctx.engine.carryPet(g.x, g.z); }
      }
      return;
    }
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.path += Math.hypot(dx, dy); p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      const s = THREE.MathUtils.clamp(this.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.dist), SCALE_MIN, SCALE_MAX);
      this.zoom = s;
      this.ctx.engine.setPetScale(AR_PET_SCALE * s);
    } else if (this.pts.size === 1 && p.path > TAP_PX && LOOK_AROUND && !this.xr.active) {
      this.pose.look(dx, dy); // dev only (?orient=mouse): drag stands in for turning the phone. Off otherwise: the view never pans on a laptop
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.petPtr?.id === e.pointerId) { // dropped: it settles where it was put down
      const g = this.petPtr.last;
      if (this.petPtr.carrying && g) this.ctx.engine.carryPet(g.x, g.z, true);
      this.petPtr = undefined;
      return;
    }
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
    this.following = false;
    const g = this.groundAt(px, py);
    if (g) this.ctx.engine.placePet(g.x, g.z, true);
  }

  private follow() { this.following = true; this.alive.focus(2.5); this.ui.toast('Following you. Say "stay" to stop.', 2500); }

  /** While following: when the user has turned more than ~14 deg away, walk to the same distance straight ahead of them. */
  private followStep() {
    const e = this.ctx.engine, cam = e.camera;
    // Compare against where the dog is heading (if it is already walking), so a longer turn re-aims the walk instead
    // of finishing a stale one first.
    const p = e.travelling && this.followTo ? this.followTo : e.petPosition, dx = p.x - cam.position.x, dz = p.z - cam.position.z;
    const f = cam.getWorldDirection(new THREE.Vector3());
    const fl = Math.hypot(f.x, f.z), dist = THREE.MathUtils.clamp(Math.hypot(dx, dz), PLACE_MIN, PLACE_MAX);
    if (fl < 0.2) return; // looking straight up or down: no heading
    const cos = (dx * f.x + dz * f.z) / (fl * (Math.hypot(dx, dz) || 1));
    if (cos >= 0.97) return;
    this.followTo = new THREE.Vector3(cam.position.x + f.x / fl * dist, 0, cam.position.z + f.z / fl * dist);
    e.placePet(this.followTo.x, this.followTo.z, true);
  }
  private followTo?: THREE.Vector3;

  /** A floor point comfortably inside the current view (lower-middle of the screen). */
  private inViewGround() {
    return (this.xr.active && this.xr.centreHit(this.frame)) || this.groundAt(innerWidth / 2, innerHeight * 0.72);
  }
}
