import type { Engine } from '../../engine';
import { createRoomScene, type RoomScene } from '../scene';
import { RoomOrbit } from '../orbit';
import type { PlayContext, PlayView } from '../types';
import { ROOM_SPOTS } from './spots';
import { KNOWN_DOGS, knownBundle } from '../../engine/sdf/known';
import type { PetBundle } from '@fetch/contracts';

export class RoomView implements PlayView {
  readonly id = 'room' as const; private ctx?: PlayContext; private room?: RoomScene; private orbit?: RoomOrbit; private ui?: HTMLElement; private started = false;
  async enter(ctx: PlayContext) { this.ctx = ctx; this.room = createRoomScene(new URLSearchParams(location.search).get('room') === 'low'); this.orbit = new RoomOrbit(ctx.engine, ctx.canvas); ctx.engine.setView('room', { petScale: .55 }); ctx.engine.setExternalCamera(true); ctx.engine.setGroundPlane(0); ctx.engine.setOverlayScene(this.room.scene); ctx.engine.setRoomColliders(this.room.colliders); ctx.engine.setSplatDepthTest(true); ctx.engine.setFurnitureSpots(ROOM_SPOTS); ctx.engine.applyPetState(ctx.session.position ? { ...ctx.session.position, heading: ctx.session.heading } : { x: 0, z: 0 }); this.renderUI(); this.started = true; }
  update(dt: number) { this.orbit?.update(dt); this.room?.update(dt); }
  resize(w: number, h: number) { this.orbit?.resize(w, h); }
  async exit() { if (!this.ctx) return; const state = this.ctx.engine.getPetState(); this.ctx.session.position = { x: state.x, z: state.z }; this.ctx.session.heading = state.heading; this.ctx.engine.setFurnitureSpots([]); this.ctx.engine.setRoomColliders([]); this.ctx.engine.setOverlayScene(null); this.orbit?.dispose(); this.orbit = undefined; this.ui?.remove(); this.ui = undefined; this.started = false; }
  private renderUI() {
    const root = this.ctx!.root;
    const petName = this.ctx?.session.bundle.name || 'Your pet';
    const ui = this.ui = document.createElement('div');
    ui.className = 'room-ui';
    ui.innerHTML = `
      <div class="room-top">
        <button class="room-work-button" data-action="back" aria-label="Back to Work dashboard">‹ <span>Back to Work</span></button>
        <div class="room-title"><span class="room-eyebrow">${petName}'s place</span><strong>Play room</strong></div>
        <button data-action="camera" aria-label="Open camera">◎</button>
      </div>
      <div class="room-status" aria-live="polite"><span class="room-dot"></span> <span class="room-status-name">${petName}</span> is home</div>
      
      <div class="room-trays">
        <div class="room-tray room-treat-tray">
          <span class="room-tray-icon">🍖</span>
          <div class="room-tray-info"><strong>Treat tray</strong><small>Give a snack</small></div>
          <div class="room-treat-buttons">
            <button class="room-treat-btn" data-action="treat" title="Give a bone" aria-label="Give ${petName} a bone">🦴</button>
            <button class="room-treat-btn" data-action="treat" title="Give a treat" aria-label="Give ${petName} a treat">🍖</button>
          </div>
        </div>
        <div class="room-tray room-toy-tray">
          <span class="room-tray-icon">🎾</span>
          <div class="room-tray-info"><strong>Toy box</strong><small>Play fetch</small></div>
          <div class="room-toy-buttons">
            <button class="room-toy-btn" data-action="toy" title="Throw a ball" aria-label="Throw a ball for ${petName}">🎾</button>
          </div>
        </div>
      </div>

      <div class="room-bottom">
        <button data-action="mic" aria-label="Push to talk">◉<small>Talk</small></button>
        <button data-action="treat" aria-label="Give a treat">✦<small>Treat</small></button>
        <button data-action="toy" aria-label="Play fetch">🎾<small>Toy</small></button>
        <button data-action="dogs" aria-label="Choose a pet" aria-haspopup="true" aria-expanded="false">🐾<small>Pets</small></button>
        <div class="room-dogs" data-dogs hidden></div>
      </div>
      <div class="room-coach" data-coach>Tap a treat or toy to play with ${petName}</div>
    `;
    root.appendChild(ui);
    ui.querySelector('[data-action="back"]')?.addEventListener('click', () => this.ctx?.exit());
    ui.querySelector('[data-action="camera"]')?.addEventListener('click', () => this.ctx?.switchTo('camera'));
    ui.querySelectorAll('[data-action="treat"]').forEach(btn => btn.addEventListener('click', () => this.ctx?.engine.feed()));
    ui.querySelectorAll('[data-action="toy"]').forEach(btn => btn.addEventListener('click', () => this.ctx?.engine.spawnBall(-0.8, 1.2, 3.5, 2.5)));
    ui.querySelector('[data-action="mic"]')?.addEventListener('click', () => this.ctx?.engine.setListening(true));
    window.setTimeout(() => ui.querySelector('[data-coach]')?.classList.add('hide'), 4200);
    this.dogPicker(ui);
  }

  /** The Pets button: built-in dogs and cats; picking one swaps the pet where it stands. */
  private dogPicker(ui: HTMLElement) {
    const btn = ui.querySelector<HTMLButtonElement>('[data-action="dogs"]')!, list = ui.querySelector<HTMLElement>('[data-dogs]')!;
    const pets: { name: string; species: string; bundle: () => Promise<PetBundle> }[] = [
      { name: 'Biscuit', species: 'dog', bundle: async () => (await fetch('/bundles/plush/bundle.json')).json() as Promise<PetBundle> },
      ...KNOWN_DOGS.map(k => ({ name: k.name, species: k.species, bundle: async () => knownBundle(k) })),
    ];
    const open = (on: boolean) => { list.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) ui.querySelector('[data-coach]')?.classList.add('hide'); };
    btn.addEventListener('click', () => open(list.hidden));
    for (const d of pets) {
      const b = document.createElement('button');
      b.innerHTML = `${d.species === 'cat' ? '🐱' : '🐶'} ${d.name}`;
      b.addEventListener('click', async () => {
        open(false); const ctx = this.ctx; if (!ctx) return;
        try {
          const bundle = await d.bundle(), at = ctx.engine.getPetState();
          await ctx.engine.loadPet(bundle); ctx.session.bundle = bundle;
          ctx.engine.setQuality(ctx.session.quality); ctx.engine.setSplatDepthTest(true); ctx.engine.applyPetState(at); ctx.engine.flourish('sparkle');
          const eyebrow = ui.querySelector('.room-eyebrow');
          if (eyebrow) eyebrow.textContent = `${d.name}'s place`;
          const statusName = ui.querySelector('.room-status-name');
          if (statusName) statusName.textContent = d.name;
        } catch (err) { console.warn('could not switch pet', err); }
      });
      list.appendChild(b);
    }
  }
}
