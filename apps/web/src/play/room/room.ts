// The Play room: a first-person toy playroom. The pet is an NPC that lives its own life here; the player walks around it,
// talks to it (same commands as the camera view) and plays with it.
import type { PetBundle } from '@fetch/contracts';
import { KNOWN_DOGS, knownBundle } from '../../engine/sdf/known';
import type { CommandId } from '../commands';
import { createRoomScene, type RoomScene } from '../scene';
import { bark } from '../sfx';
import { Talk } from '../talk';
import { commandSteps } from '../tricks';
import type { PlayContext, PlayView } from '../types';
import { FirstPerson } from './fps';
import { ITEMS, RoomHud, type ItemId } from './hud';
import { ROOM_SPOTS } from './spots';

const PET_SCALE = 0.65;       // a little bigger than the old orbit view: the player now stands next to it
const NOTICE = 3.2;           // metres: closer than this, the pet looks at the player
const HOLD_SECS = 8;          // sit / lie down last this long here, then the pet goes back to its own life
const FOLLOW_GAP = 1.3, FOLLOW_SLACK = 0.5; // "follow me": stay this close, start walking once this much further away

export class RoomView implements PlayView {
  readonly id = 'room' as const;
  private ctx?: PlayContext; private room?: RoomScene; private fps?: FirstPerson; private hud?: RoomHud; private talk?: Talk;
  private item: ItemId = 'hand';
  private following = false; private followT = 0;
  private fetches = 0; private tricks = 0;

  async enter(ctx: PlayContext) {
    this.ctx = ctx;
    const e = ctx.engine, room = this.room = createRoomScene();
    this.fps = new FirstPerson(e, ctx.root, [...room.colliders, ...room.playerColliders]);
    e.setView('room', { petScale: PET_SCALE });
    e.setExternalCamera(true); e.setPointerInteractions(false);
    e.setGroundPlane(0); e.setOverlayScene(room.scene); e.setRoomColliders(room.colliders);
    e.setSplatDepthTest(true); e.setFurnitureSpots(ROOM_SPOTS);
    e.applyPetState(ctx.session.position ? { ...ctx.session.position, heading: ctx.session.heading } : { x: 0, z: 0 });
    this.buildHud();
    window.addEventListener('keydown', this.onKey);
  }

  update(dt: number) {
    const e = this.ctx?.engine, fps = this.fps;
    if (!e || !fps) return;
    fps.update(dt);
    this.room?.update(dt);
    // the pet notices the player: its head follows them when they are close
    const pet = e.petPosition, gap = Math.hypot(pet.x - fps.position.x, pet.z - fps.position.z);
    e.setLookAt(gap < NOTICE ? fps.position : null);
    if (this.following && (this.followT -= dt) <= 0) {
      this.followT = 0.35;
      if (gap > FOLLOW_GAP + FOLLOW_SLACK) { const k = FOLLOW_GAP / gap; e.placePet(fps.position.x + (pet.x - fps.position.x) * k, fps.position.z + (pet.z - fps.position.z) * k, true); }
    }
    this.hud?.hearts(e.stats?.happiness ?? 0);
  }
  resize(w: number, h: number) { this.fps?.resize(w, h); }

  async exit() {
    const ctx = this.ctx;
    if (!ctx) return;
    window.removeEventListener('keydown', this.onKey);
    const state = ctx.engine.getPetState();
    ctx.session.position = { x: state.x, z: state.z }; ctx.session.heading = state.heading;
    ctx.engine.setLookAt(null); ctx.engine.setListening(false); ctx.engine.setPointerInteractions(true);
    ctx.engine.setFurnitureSpots([]); ctx.engine.setRoomColliders([]); ctx.engine.setOverlayScene(null);
    this.following = false;
    this.talk?.dispose(); this.talk = undefined;
    this.fps?.dispose(); this.fps = undefined;
    this.room?.dispose(); this.room = undefined;
    this.hud?.el.remove(); this.hud = undefined;
  }

  // ---------- HUD ----------
  private buildHud() {
    const ctx = this.ctx!, fps = this.fps!, touch = matchMedia('(pointer: coarse)').matches;
    const pets: { name: string; species: string; bundle: () => Promise<PetBundle> }[] = [
      { name: 'Biscuit', species: 'dog', bundle: async () => (await fetch('/bundles/plush/bundle.json')).json() as Promise<PetBundle> },
      ...KNOWN_DOGS.map(k => ({ name: k.name, species: k.species, bundle: async () => knownBundle(k) })),
    ];
    const hud = this.hud = new RoomHud({
      back: () => ctx.exit(),
      camera: () => { fps.release(); ctx.switchTo('camera'); },
      mic: () => this.talk?.toggle(),
      pick: id => this.pick(id),
      panel: () => fps.release(),
      pets: pets.map(p => ({ name: `${p.species === 'cat' ? '\u{1f431}' : '\u{1f436}'} ${p.name}`, pick: () => void this.swapPet(p.bundle) })),
    }, touch);
    hud.el.insertAdjacentHTML('beforeend', "<div class=\"room-trays\">\n        <div class=\"room-tray room-treat-tray\">\n          <span class=\"room-tray-icon\">🍖</span>\n          <div class=\"room-tray-info\"><strong>Treat tray</strong><small>Give a snack</small></div>\n          <div class=\"room-treat-buttons\">\n            <button class=\"room-treat-btn\" data-action=\"treat\" title=\"Give a bone\" aria-label=\"Give your pet a bone\">🦴</button>\n            <button class=\"room-treat-btn\" data-action=\"treat\" title=\"Give a treat\" aria-label=\"Give your pet a treat\">🍖</button>\n          </div>\n        </div>\n        <div class=\"room-tray room-toy-tray\">\n          <span class=\"room-tray-icon\">🎾</span>\n          <div class=\"room-tray-info\"><strong>Toy box</strong><small>Play fetch</small></div>\n          <div class=\"room-toy-buttons\">\n            <button class=\"room-toy-btn\" data-action=\"toy\" title=\"Throw a ball\" aria-label=\"Throw a ball for your pet\">🎾</button>\n          </div>\n        </div>\n      </div>");
    hud.el.querySelectorAll('[data-action="treat"]').forEach(btn => btn.addEventListener('click', () => ctx.engine.feed()));
    hud.el.querySelectorAll('[data-action="toy"]').forEach(btn => btn.addEventListener('click', () => ctx.engine.spawnBall(-0.8, 1.2, 3.5, 2.5)));
    ctx.root.appendChild(hud.el);
    hud.owner(ctx.session.bundle.name); hud.item(this.item); hud.counts(this.fetches, this.tricks);
    // the hint stays until the player has the controls (mouse captured), or for a few seconds
    hud.coach(touch ? 'Left thumb walks · drag to look around' : 'Click to look around · WASD to walk · Esc to let go');
    window.setTimeout(() => this.hud?.coach(''), touch ? 5000 : 9000);
    fps.onLock = locked => { if (locked) hud.coach(''); };

    this.talk = new Talk({
      toast: (t, ms) => hud.toast(t, ms), setVoice: s => hud.setVoice(s), micLevel: v => hud.micLevel(v),
      listening: on => ctx.engine.setListening(on),
      run: id => this.run(id), love: () => this.love(),
    });
    hud.micEnabled(this.talk.voice.supported);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0) this.pick(ITEMS[n].id);
    else if (e.code === 'KeyT') this.talk?.toggle();
  };
  private pick(id: ItemId) { this.item = id; this.hud?.item(id); }

  private async swapPet(load: () => Promise<PetBundle>) {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const bundle = await load(), at = ctx.engine.getPetState();
      await ctx.engine.loadPet(bundle); ctx.session.bundle = bundle;
      ctx.engine.setQuality(ctx.session.quality); ctx.engine.setSplatDepthTest(true); ctx.engine.applyPetState(at); ctx.engine.flourish('sparkle');
      this.hud?.owner(bundle.name);
    } catch (err) { console.warn('could not switch pet', err); }
  }

  // ---------- voice commands (same tricks as the camera view) ----------
  private run(id: CommandId) {
    const e = this.ctx!.engine, fps = this.fps!;
    this.following = id === 'follow';
    this.hud?.counts(this.fetches, ++this.tricks);
    if (id === 'follow') { this.followT = 0; this.hud?.toast('Following you. Say another command to stop.', 2500); return; }
    e.perform(commandSteps(id, { engine: e, eye: fps.position, forward: fps.forward(), reach: [0.8, 12], hold: HOLD_SECS, woof: () => this.woof() }));
  }
  private love() {
    const e = this.ctx!.engine, eye = this.fps!.position;
    this.following = false;
    e.perform([{ call: () => e.faceToward(eye.x, eye.z) }, { call: () => e.flourish('heart') }, { clip: 'wag', secs: 2 }]);
  }
  private woof() {
    bark();
    const e = this.ctx!.engine, p = e.petPosition;
    p.y += 1.05 * e.scaleNow;
    const n = p.project(e.camera);
    if (n.z < 1) this.hud?.bubble('Woof!', (n.x + 1) / 2 * innerWidth, (1 - n.y) / 2 * innerHeight); // only when the pet is in front of the player
  }

  /** Test seam (room harness, console): act as if this phrase was heard. */
  say(text: string) { this.talk?.heard(text); }
  get player() { return this.fps; }
}
