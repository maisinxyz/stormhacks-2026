// play.md Part B (B.2-B.8): the Snapchat-style camera view. Live video fills the screen, the engine canvas is
// stacked on top (transparent), and the phone's orientation drives the 3D camera so the dog stays put in the room.
import * as THREE from 'three';
import { interpret, type CommandId } from '../commands';
import { bark } from '../sfx';
import { PushToTalk } from '../voice';
import type { PerformStep } from '../../engine/behavior';
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
  'not-allowed': 'Microphone access is blocked. Allow it in the browser to talk to your dog.',
  'audio-capture': 'No microphone found.',
  'model-unavailable': 'The voice model could not be downloaded (needs internet once).',
};
const SLOW_MS = 4000, LATE_MS = 8000; // no command within 4 s -> wag + hearts; an answer later than 8 s is dropped
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
  /** "Follow": the dog walks toward the cursor while this mode is active. */
  private following = false;
  private cursorTarget?: THREE.Vector3;
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
      this.voice = new PushToTalk(t => this.heard(t), code => this.voiceFailed(code), text => this.ui.toast(text, 4000), s => this.voiceState(s));
      this.ui = new CameraUi({
        back: () => ctx.switchTo('room'),
        flip: () => void this.stream.flip().catch(err => this.fail(err)),
        recenter: () => this.recenter(),
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
    this.cursorTarget = undefined;
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
    window.clearTimeout(this.slowTimer);
    if (s === 'interpreting') { // slow answer: react now with a wag and hearts; the real command still runs when it arrives
      this.interpretingSince = performance.now();
      this.slowTimer = window.setTimeout(() => this.love(), SLOW_MS);
    }
  }
  private slowTimer = 0;
  private interpretingSince = 0;
  /** The microphone or the recognizer failed: say why when the user can fix it, and still give them a happy dog. */
  private voiceFailed(code: string) {
    window.clearTimeout(this.slowTimer);
    if (VOICE_ERRORS[code]) this.ui.toast(VOICE_ERRORS[code], 6000);
    this.love();
  }
  private levelTimer = 0;

  private recenter() {
    this.following = false;
    this.cursorTarget = undefined;
    if (this.xr.active) { const g = this.inViewGround(); if (g) this.ctx.engine.placePet(g.x, g.z, false); }
    else {
      this.pose.recenter();
      // the view is re-zeroed on the next sensor frame: pick the middle of the screen after that, not before
      window.setTimeout(() => { const g = this.entered && this.inViewGround(); if (g) this.ctx.engine.placePet(g.x, g.z, true); }, 150);
    }
    this.alive.focus(2);
    this.ui.toast('Dog centered.');
  }

  // ---------- voice (B.7): whatever is said becomes the nearest command; the dog always does something ----------
  private heard(text: string) {
    window.clearTimeout(this.slowTimer);
    const late = this.interpretingSince > 0 && performance.now() - this.interpretingSince > LATE_MS; // far too late to be a reply to what was said
    this.interpretingSince = 0;
    if (late) return;
    const m = interpret(text);
    this.ui.toast(m ? `Heard "${text}" → ${m.label}` : `Heard "${text}"`, 3000);
    if (m) this.run(m.id); else this.love();
  }

  /** Nothing understood, nothing heard, or the answer is slow: a happy wag and hearts, so the dog never ignores the user. */
  private love() {
    const e = this.ctx.engine;
    this.following = false;
    this.alive.focus(2.5);
    e.perform([{ call: () => e.faceToward(e.camera.position.x, e.camera.position.z) }, { call: () => e.flourish('heart') }, { clip: 'wag', secs: 2 }]);
  }

  private woof() {
    bark();
    const e = this.ctx.engine, p = e.petPosition;
    p.y += 1.05 * e.scaleNow;
    const n = p.project(e.camera);
    this.ui.bubble('Woof!', (n.x + 1) / 2 * innerWidth, (1 - n.y) / 2 * innerHeight);
  }

  private lastSurprise = -1;
  /** The 19 commands (+ "stand up"). A new command replaces the running one at once. Directions are the user's: left/right
   *  across the screen, "up" away from the user, "down" toward them. */
  private run(id: CommandId) {
    const e = this.ctx.engine, cam = e.camera, p = e.petPosition;
    this.following = false;
    this.alive.focus(3);
    const f = cam.getWorldDirection(new THREE.Vector3()); f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    const right = new THREE.Vector3(-f.z, 0, f.x), foot = new THREE.Vector3(cam.position.x, 0, cam.position.z);
    /** A floor point `a` metres to the user's right and `b` metres away from them, kept within reach of the camera. */
    const by = (a: number, b: number) => { const d = new THREE.Vector3(p.x, 0, p.z).addScaledVector(right, a).addScaledVector(f, b).sub(foot); return foot.clone().add(d.setLength(THREE.MathUtils.clamp(d.length(), PLACE_MIN, PLACE_MAX))); };
    /** The point `dist` metres from the user, on the line to the dog. */
    const near = (dist: number) => { const d = new THREE.Vector3(p.x - foot.x, 0, p.z - foot.z); if (d.lengthSq() < 1e-4) d.copy(f); return foot.clone().add(d.setLength(dist)); };
    const face: PerformStep = { call: () => e.faceToward(cam.position.x, cam.position.z) };
    const woof: PerformStep[] = [{ call: () => this.woof() }, { clip: 'perk', secs: 0.55 }];
    const hearts: PerformStep = { call: () => e.flourish('heart') }, sparkle: PerformStep = { call: () => e.flourish('sparkle') };
    const wag = (secs = 1.3, speed = 1): PerformStep => ({ clip: 'wag', secs, speed });
    const go = (a: number, b: number): PerformStep[] => [{ to: by(a, b) }, face, { clip: 'stand', secs: 1 }];
    const tricks: PerformStep[][] = [
      [{ clip: 'beg', secs: 2.4 }], [{ clip: 'playBow', secs: 1.4 }, { clip: 'jump' }], [{ clip: 'spin' }, { clip: 'spin' }],
      [{ clip: 'roll' }, { clip: 'jump' }], [{ clip: 'hide', secs: 1.6 }, { clip: 'startle' }], [{ clip: 'scratch', secs: 2 }], [{ clip: 'count', secs: 2 }],
    ];
    const seq: Record<Exclude<CommandId, 'follow'>, () => PerformStep[]> = {
      sit: () => [face, { clip: 'sit', hold: true }],
      come: () => [{ to: near(1.2), fast: true }, face, ...woof, wag(1.5)],
      lie: () => [face, { clip: 'lie', hold: true }],
      jump: () => [face, { clip: 'jump' }, ...woof, wag(1)],
      left: () => go(-0.9, 0), right: () => go(0.9, 0), up: () => go(0, 0.9), down: () => go(0, -0.9),
      turn: () => [{ clip: 'spin' }, face, { clip: 'stand', secs: 0.6 }],
      love: () => [{ to: near(1), fast: true }, face, hearts, { clip: 'tilt', secs: 1.6 }, hearts, wag(1.5)],
      good: () => [face, hearts, { clip: 'jump' }, wag(1.6, 1.8)],
      paw: () => [face, { clip: 'shake', secs: 2.6 }],
      hi: () => [face, { clip: 'shake', secs: 1.6, speed: 1.4 }, ...woof],
      look: () => [face, { clip: 'perk', secs: 3 }],
      dance: () => [sparkle, { clip: 'dance', secs: 2.4 }, { clip: 'spin' }, face, ...woof],
      dead: () => [face, { clip: 'playDead', secs: 3.2 }, { clip: 'startle' }, wag(1)],
      roll: () => [{ clip: 'roll' }, { clip: 'stand', secs: 0.5 }],
      surprise: () => { let i = this.lastSurprise; while (i === this.lastSurprise) i = Math.floor(Math.random() * tricks.length); this.lastSurprise = i; return [sparkle, face, ...tricks[i]]; },
      stand: () => [{ clip: 'stand', secs: 0.3 }],
    };
    if (id === 'follow') this.follow(); else e.perform(seq[id]());
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
    if (this.following && !this.petPtr && !this.pinch && !(e.target as HTMLElement | null)?.closest?.('[data-ui]')) {
      const g = this.groundAt(e.clientX, e.clientY);
      if (g) { this.cursorTarget = g.clone(); this.ctx.engine.placePet(g.x, g.z, true); }
    }
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
    // Reserve a generous edge margin for the dog's full footprint. This also
    // clamps Follow targets, so pointer movement cannot send the dog off-screen.
    const marginX = Math.max(64, innerWidth * .14);
    const safeX = THREE.MathUtils.clamp(px, marginX, innerWidth - marginX);
    const safeY = THREE.MathUtils.clamp(py, innerHeight * .58, innerHeight * .86);
    const e = this.ctx.engine, g = e.groundPoint(safeX, safeY);
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

  private follow() { this.following = true; this.cursorTarget = undefined; this.alive.focus(2.5); this.ui.toast('Following the cursor. Say another command to stop.', 2500); }

  /** While following: when the user has turned more than ~14 deg away, walk to the same distance straight ahead of them. */
  private followStep() {
    const e = this.ctx.engine;
    if (this.cursorTarget) { e.placePet(this.cursorTarget.x, this.cursorTarget.z, true); return; }
    return;
  }

  /** A floor point comfortably inside the current view (lower-middle of the screen). */
  private inViewGround() {
    return (this.xr.active && this.xr.centreHit(this.frame)) || this.groundAt(innerWidth / 2, innerHeight * 0.72);
  }
}
