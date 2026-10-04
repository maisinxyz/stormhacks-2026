// The Play room: a first-person toy playroom. The pet is an NPC that lives its own life here; the player walks around it.
import type { PetBundle } from '@fetch/contracts';
import { KNOWN_DOGS, knownBundle } from '../../engine/sdf/known';
import { createRoomScene, type RoomScene } from '../scene';
import type { PlayContext, PlayView } from '../types';
import { FirstPerson } from './fps';
import { ROOM_SPOTS } from './spots';

const PET_SCALE = 0.65;   // a little bigger than the old orbit view: the player now stands next to it
const NOTICE = 3.2;       // metres: closer than this, the pet looks at the player

export class RoomView implements PlayView {
  readonly id = 'room' as const;
  private ctx?: PlayContext; private room?: RoomScene; private fps?: FirstPerson; private ui?: HTMLElement;

  async enter(ctx: PlayContext) {
    this.ctx = ctx;
    const e = ctx.engine, room = this.room = createRoomScene();
    this.fps = new FirstPerson(e, ctx.root, [...room.colliders, ...room.playerColliders]);
    e.setView('room', { petScale: PET_SCALE });
    e.setExternalCamera(true); e.setPointerInteractions(false);
    e.setGroundPlane(0); e.setOverlayScene(room.scene); e.setRoomColliders(room.colliders);
    e.setSplatDepthTest(true); e.setFurnitureSpots(ROOM_SPOTS);
    e.applyPetState(ctx.session.position ? { ...ctx.session.position, heading: ctx.session.heading } : { x: 0, z: 0 });
    this.renderUI();
  }

  update(dt: number) {
    const e = this.ctx?.engine, fps = this.fps;
    if (!e || !fps) return;
    fps.update(dt);
    this.room?.update(dt);
    // the pet notices the player: its head follows them when they are close
    const pet = e.petPosition;
    e.setLookAt(Math.hypot(pet.x - fps.position.x, pet.z - fps.position.z) < NOTICE ? fps.position : null);
  }
  resize(w: number, h: number) { this.fps?.resize(w, h); }

  async exit() {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.engine.getPetState();
    ctx.session.position = { x: state.x, z: state.z }; ctx.session.heading = state.heading;
    ctx.engine.setLookAt(null); ctx.engine.setPointerInteractions(true);
    ctx.engine.setFurnitureSpots([]); ctx.engine.setRoomColliders([]); ctx.engine.setOverlayScene(null);
    this.fps?.dispose(); this.fps = undefined;
    this.room?.dispose(); this.room = undefined;
    this.ui?.remove(); this.ui = undefined;
  }

  private renderUI() {
    const ctx = this.ctx!, name = ctx.session.bundle.name, touch = matchMedia('(pointer: coarse)').matches;
    const ui = this.ui = document.createElement('div');
    ui.className = 'room-ui';
    ui.innerHTML = `<div class="room-top"><button class="room-work-button" data-action="back" aria-label="Back to Work dashboard">‹ <span>Back to Work</span></button><div class="room-title"><span class="room-eyebrow" data-owner></span><strong>Play room</strong></div><button data-action="camera" aria-label="Open camera">◎</button></div>`
      + `<div class="room-cross" aria-hidden="true"></div>`
      + `<div class="room-bottom"><button data-action="mic" aria-label="Push to talk">◉<small>Talk</small></button><button data-action="treat" aria-label="Give a treat">✦<small>Treat</small></button><button data-action="dogs" aria-label="Choose a pet" aria-haspopup="true" aria-expanded="false">🐾<small>Pets</small></button><div class="room-dogs" data-dogs hidden></div></div>`
      + `<div class="room-coach" data-coach>${touch ? 'Left thumb walks · drag to look around' : 'Click to look around · WASD to walk · Esc to let go'}</div>`;
    ui.querySelector('[data-owner]')!.textContent = `${name}'s place`;
    ctx.root.appendChild(ui);
    const on = (action: string, fn: () => void) => ui.querySelector(`[data-action="${action}"]`)?.addEventListener('click', fn);
    on('back', () => ctx.exit());
    on('camera', () => { this.fps?.release(); ctx.switchTo('camera'); });
    on('treat', () => ctx.engine.feed());
    on('mic', () => ctx.engine.setListening(true));
    // the hint stays until the player has the controls (mouse captured, or a few seconds on a phone)
    const coach = ui.querySelector<HTMLElement>('[data-coach]')!;
    window.setTimeout(() => coach.classList.add('hide'), touch ? 5000 : 9000);
    this.fps!.onLock = locked => { coach.classList.toggle('hide', locked); ui.classList.toggle('playing', locked); };
    this.dogPicker(ui);
  }

  /** The Pets button: a small list of the built-in pet models; picking one swaps the pet where it stands. */
  private dogPicker(ui: HTMLElement) {
    const btn = ui.querySelector<HTMLButtonElement>('[data-action="dogs"]')!, list = ui.querySelector<HTMLElement>('[data-dogs]')!;
    const dogs: { name: string; bundle: () => Promise<PetBundle> }[] = [
      { name: 'Biscuit', bundle: async () => (await fetch('/bundles/plush/bundle.json')).json() as Promise<PetBundle> },
      ...KNOWN_DOGS.map(k => ({ name: k.name, bundle: async () => knownBundle(k) })),
    ];
    const open = (on: boolean) => { list.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) this.fps?.release(); };
    btn.addEventListener('click', () => open(list.hidden));
    for (const d of dogs) {
      const b = document.createElement('button'); b.textContent = d.name;
      b.addEventListener('click', async () => {
        open(false); const ctx = this.ctx; if (!ctx) return;
        try {
          const bundle = await d.bundle(), at = ctx.engine.getPetState();
          await ctx.engine.loadPet(bundle); ctx.session.bundle = bundle;
          ctx.engine.setQuality(ctx.session.quality); ctx.engine.setSplatDepthTest(true); ctx.engine.applyPetState(at); ctx.engine.flourish('sparkle');
          ui.querySelector('[data-owner]')!.textContent = `${bundle.name}'s place`;
        } catch (err) { console.warn('could not switch dog', err); }
      });
      list.appendChild(b);
    }
  }
}
