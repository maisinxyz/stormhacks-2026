// The Play room: a first-person toy playroom. The pet is an NPC that lives its own life here; the player walks around it,
// talks to it (same commands as the camera view) and plays with it.
import * as THREE from 'three';
import type { CommandId } from '../commands';
import { createRoomScene, ROOM_SPEC, type RoomScene } from '../scene';
import { crunch, thump, whoosh } from '../sfx';
import { Talk } from '../talk';
import { commandSteps } from '../tricks';
import type { PlayContext, PlayView } from '../types';
import { FirstPerson } from './fps';
import { ITEMS, RoomHud, type ItemId } from './hud';
import { ROOM_SPOTS } from './spots';
import { Toys3D } from './toys3d';
import { callOut, react, SPOKEN, type LineId } from '../../voice/petcall';

const PET_SCALE = 0.65;       // a little bigger than the old orbit view: the player now stands next to it
const NOTICE = 3.2;           // metres: closer than this, the pet looks at the player
const HOLD_SECS = 8;          // sit / lie down last this long here, then the pet goes back to its own life
const FOLLOW_GAP = 1.3, FOLLOW_SLACK = 0.5; // "follow me": stay this close, start walking once this much further away
const REACH = 2.2;            // metres: feed or stroke the pet from this close
const POINT = 7;              // metres: point at the hoop or the tunnel from this far
type Aim = 'pet' | 'hoop' | 'tunnel';

export class RoomView implements PlayView {
  readonly id = 'room' as const;
  private ctx?: PlayContext; private room?: RoomScene; private fps?: FirstPerson; private hud?: RoomHud; private talk?: Talk; private toys?: Toys3D;
  private item: ItemId = 'hand';
  private following = false; private followT = 0;
  private fetches = 0; private tricks = 0;
  private beg = 0;              // seconds until the pet may come begging again
  private tunnelOpenFor = 0;    // seconds the tunnel stays walkable for the pet

  async enter(ctx: PlayContext) {
    this.ctx = ctx;
    const e = ctx.engine, room = this.room = createRoomScene();
    this.fps = new FirstPerson(e, ctx.root, [...room.colliders, ...room.playerColliders]);
    e.setView('room', { petScale: PET_SCALE });
    e.setExternalCamera(true); e.setPointerInteractions(false);
    e.setGroundPlane(0); e.setOverlayScene(room.scene); e.setRoomColliders(room.colliders);
    e.setSplatDepthTest(true); e.setFurnitureSpots(ROOM_SPOTS);
    e.applyPetState(ctx.session.position ? { ...ctx.session.position, heading: ctx.session.heading } : { x: 0, z: 0 });
    this.toys = new Toys3D(e, room.scene, room.colliders, () => this.fps!.position);
    this.toys.onFetched = () => { this.hud?.counts(++this.fetches, this.tricks); this.voiceLine('fetched'); };
    this.toys.onThrow = kind => whoosh(kind === 'frisbee');
    this.toys.onBounce = speed => thump(speed);
    this.fps.onPrimary = down => this.primary(down);
    this.buildHud();
    window.addEventListener('keydown', this.onKey);
  }

  update(dt: number) {
    const e = this.ctx?.engine, fps = this.fps;
    if (!e || !fps) return;
    fps.update(dt);
    this.room?.update(dt);
    const toys = this.toys!;
    e.camera.updateMatrixWorld();
    toys.hold(this.item === 'hand' ? undefined : this.item, e.camera);
    toys.update(dt);
    this.hud?.charge(toys.charge);
    // the pet watches a toy in the air, and otherwise notices the player when they are close
    const pet = e.petPosition, gap = Math.hypot(pet.x - fps.position.x, pet.z - fps.position.z);
    e.setLookAt(toys.attention ?? (gap < NOTICE ? fps.position : null));
    if (this.following && (this.followT -= dt) <= 0) {
      this.followT = 0.35;
      if (gap > FOLLOW_GAP + FOLLOW_SLACK) { const k = FOLLOW_GAP / gap; e.placePet(fps.position.x + (pet.x - fps.position.x) * k, fps.position.z + (pet.z - fps.position.z) * k, true); }
    }
    this.hud?.hearts(e.stats?.happiness ?? 0);
    this.hud?.aim(!!this.aim());
    // holding the food: the pet trots over and begs (only when it has nothing else on)
    this.beg -= dt;
    if (this.item === 'food' && this.beg <= 0 && gap > REACH && !toys.out && !this.following && e.getPetState().state !== 'intent') { this.beg = 5; this.comeAndBeg(); }
    if (this.tunnelOpenFor > 0 && (this.tunnelOpenFor -= dt) <= 0) e.setRoomColliders(this.room!.colliders);
  }
  resize(w: number, h: number) { this.fps?.resize(w, h); }

  async exit() {
    const ctx = this.ctx;
    if (!ctx) return;
    window.removeEventListener('keydown', this.onKey);
    const state = ctx.engine.getPetState();
    ctx.session.position = { x: state.x, z: state.z }; ctx.session.heading = state.heading;
    ctx.engine.setSpeaking(0);
    ctx.engine.setLookAt(null); ctx.engine.setListening(false); ctx.engine.setPointerInteractions(true);
    ctx.engine.setFurnitureSpots([]); ctx.engine.setRoomColliders([]); ctx.engine.setOverlayScene(null);
    this.following = false;
    this.toys?.cancel(); this.toys = undefined;
    this.tunnelOpenFor = 0;
    this.talk?.dispose(); this.talk = undefined;
    this.fps?.dispose(); this.fps = undefined;
    this.room?.dispose(); this.room = undefined;
    this.hud?.el.remove(); this.hud = undefined;
  }

  // ---------- HUD ----------
  private buildHud() {
    const ctx = this.ctx!, fps = this.fps!, touch = matchMedia('(pointer: coarse)').matches;
    const hud = this.hud = new RoomHud({
      back: () => ctx.exit(),
      camera: () => { fps.release(); ctx.switchTo('camera'); },
      mic: () => this.talk?.toggle(),
      use: down => this.primary(down),
      pick: id => this.pick(id),
      panel: () => fps.release(),
    }, touch);
    ctx.root.appendChild(hud.el);
    hud.owner(ctx.session.bundle.name); hud.item(this.item); hud.counts(this.fetches, this.tricks);
    this.coach(touch);
    // the pet greets the player the first time they take the controls (audio needs that click anyway)
    let greeted = false;
    fps.onLock = locked => { if (locked && !greeted) { greeted = true; this.voiceLine('greeting'); } };

    this.talk = new Talk({
      toast: (t, ms) => hud.toast(t, ms), setVoice: s => hud.setVoice(s), micLevel: v => hud.micLevel(v),
      listening: on => ctx.engine.setListening(on),
      run: id => this.run(id), love: () => this.love(),
    });
    hud.micEnabled(this.talk.voice.supported);
  }

  /** First visit: three short hints, one after another. Any key or tap moves on (once the hint has been up a moment). */
  private coach(touch: boolean) {
    const name = this.ctx!.session.bundle.name;
    const hints = touch
      ? ['Left thumb walks · drag on the right to look around', 'Pick an item below · hold the round button to throw harder', `Tap the mic and talk to ${name}: sit, come here, dance...`]
      : ['Click to look around · WASD to walk · Esc to let go of the mouse', '1-4 picks an item · hold the mouse button to throw harder', `Press U and talk to ${name}: sit, come here, dance...`];
    try { if (localStorage.getItem('fetch.play.roomcoach')) hints.length = 1; else localStorage.setItem('fetch.play.roomcoach', '1'); } catch { /* private mode: show them every time */ }
    let i = -1, shown = 0, timer = 0;
    const next = () => {
      window.clearTimeout(timer);
      if (!this.hud || ++i >= hints.length) { this.hud?.coach(''); window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); return; }
      this.hud.coach(hints[i]); shown = performance.now();
      timer = window.setTimeout(next, 6000);
    };
    const skip = () => { if (performance.now() - shown > 1500) next(); };
    window.addEventListener('keydown', skip); window.addEventListener('pointerdown', skip);
    next();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0) this.pick(ITEMS[n].id);
    else if (e.code === 'KeyU') this.talk?.toggle();
  };
  private pick(id: ItemId) { this.item = id; this.hud?.item(id); this.beg = 0.6; }

  /** The main button (mouse, or the on-screen action button): what it does depends on the held item. */
  private primary(down: boolean) {
    const toys = this.toys, fps = this.fps;
    if (!toys || !fps) return;
    if (this.item === 'ball' || this.item === 'frisbee') {
      if (!down) toys.release(fps.forward());
      else if (!toys.press(this.item)) this.hud?.toast(`${this.ctx!.session.bundle.name} has the ${toys.out}. It will bring it back.`, 2200);
      else this.following = false;
      return;
    }
    if (!down) return;
    const e = this.ctx!.engine, name = this.ctx!.session.bundle.name, aim = this.aim(), eye = fps.position;
    const face = { call: () => e.faceToward(eye.x, eye.z) }, hearts = { call: () => e.flourish('heart') };
    if (this.item === 'food') {
      if (aim !== 'pet') { this.hud?.toast(`Get closer to ${name} and look at it to feed it.`, 2500); this.comeAndBeg(); return; }
      this.following = false; toys.cancel();
      e.faceToward(eye.x, eye.z);
      if (e.feed()) { e.flourish('heart'); this.hud?.toast(`${name} loved that.`, 1800); crunch(); window.setTimeout(() => this.voiceLine('fed'), 600); }
      else this.hud?.toast(`${name} does not eat that.`, 1800);
    } else if (aim === 'pet') { // empty hand on the pet: a stroke
      this.following = false; toys.cancel();
      e.petted(); this.voiceLine('stroked');
      e.perform([face, hearts, { clip: 'wag', secs: 1.6 }, hearts]);
    } else if (aim) this.send(aim);
  }

  /** What the crosshair is on: the pet (within reach), or the hoop / tunnel (within pointing distance). */
  private aim(): Aim | undefined {
    const e = this.ctx?.engine, fps = this.fps;
    if (!e || !fps) return;
    const ray = new THREE.Ray(fps.position, fps.forward()), s = e.scaleNow, p = e.petPosition, hit = new THREE.Vector3();
    const on = (x: number, y: number, z: number, r: number, far: number) => !!ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(x, y, z), r), hit) && hit.distanceTo(fps.position) < far;
    if (on(p.x, 0.45 * s, p.z, 0.62 * s, REACH)) return 'pet';
    if (this.item !== 'hand') return;
    const H = ROOM_SPEC.hoop, T = ROOM_SPEC.tunnel;
    if (on(H.x, H.y, H.z, H.radius + 0.1, POINT)) return 'hoop';
    for (const dx of [-0.6, 0, 0.6]) if (on(T.x + dx, T.radius, T.z, T.radius + 0.1, POINT)) return 'tunnel';
    return;
  }

  /** The pet trots over to the player and begs. */
  private comeAndBeg() {
    const e = this.ctx!.engine, eye = this.fps!.position, p = e.petPosition, d = new THREE.Vector3(p.x - eye.x, 0, p.z - eye.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    d.setLength(1.3);
    e.perform([{ to: { x: eye.x + d.x, z: eye.z + d.z }, fast: true }, { call: () => e.faceToward(eye.x, eye.z) }, { clip: 'beg', secs: 2.5 }]);
  }

  /** Point at the hoop or the tunnel with an empty hand: the pet runs over and goes through it (from its nearer side). */
  private send(what: 'hoop' | 'tunnel') {
    const e = this.ctx!.engine, p = e.petPosition, eye = this.fps!.position;
    const S = ROOM_SPEC[what], half = what === 'hoop' ? 1.0 : ROOM_SPEC.tunnel.length / 2 + 0.55, side = p.x < S.x ? -1 : 1;
    this.following = false; this.toys?.cancel();
    const done = [{ call: () => { e.played(); this.hud?.counts(this.fetches, ++this.tricks); e.flourish('sparkle'); e.faceToward(eye.x, eye.z); this.voiceLine('trick'); } }, { clip: 'wag', secs: 1.4 }];
    if (what === 'tunnel') { // the tunnel is solid to the pet except while it is sent through
      e.setRoomColliders(this.room!.colliders.filter(c => c !== this.room!.tunnelCollider));
      this.tunnelOpenFor = 9;
    }
    e.perform([{ to: { x: S.x + side * half, z: S.z }, fast: true }, { to: { x: S.x - side * half, z: S.z }, fast: true }, ...(what === 'hoop' ? [{ clip: 'jump' }] : []), ...done]);
  }

  // ---------- voice commands (same tricks as the camera view) ----------
  private run(id: CommandId) {
    const e = this.ctx!.engine, fps = this.fps!;
    this.following = id === 'follow';
    this.toys?.cancel(); // a command interrupts a fetch: the toy goes back to the hand
    this.hud?.counts(this.fetches, ++this.tricks);
    const spoken = SPOKEN[id];
    if (spoken) this.voiceLine(spoken);
    if (id === 'follow') { this.followT = 0; this.hud?.toast('Following you. Say another command to stop.', 2500); return; }
    e.perform(commandSteps(id, { engine: e, eye: fps.position, forward: fps.forward(), reach: [0.8, 12], hold: HOLD_SECS, woof: () => this.woof() }));
  }
  private love() {
    const e = this.ctx!.engine, eye = this.fps!.position;
    this.following = false; this.toys?.cancel();
    this.voiceLine('unknown');
    e.perform([{ call: () => e.faceToward(eye.x, eye.z) }, { call: () => e.flourish('heart') }, { clip: 'wag', secs: 2 }]);
  }
  /** The pet reacts with a cute call (yips or a mew), head bobbing with the sound. */
  private voiceLine(id: LineId) { const ctx = this.ctx; if (ctx) react(id, ctx.session.bundle, a => ctx.engine.setSpeaking(a)); }

  private woof() {
    if (this.ctx) void callOut(this.ctx.session.bundle, a => this.ctx!.engine.setSpeaking(a), 2);
    const e = this.ctx!.engine, p = e.petPosition;
    p.y += 1.05 * e.scaleNow;
    const n = p.project(e.camera);
    if (n.z < 1) this.hud?.bubble('Woof!', (n.x + 1) / 2 * innerWidth, (1 - n.y) / 2 * innerHeight); // only when the pet is in front of the player
  }

  /** Test seam (room harness, console): act as if this phrase was heard. */
  say(text: string) { this.talk?.heard(text); }
  get player() { return this.fps; }
}
