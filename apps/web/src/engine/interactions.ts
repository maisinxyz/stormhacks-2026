// PRD 1.8 pointer interactions on the pet: stroke -> PET_STROKE, click -> POKE, flick ball -> THROW,
// food drop -> FEED, empty click -> POINT, cursor tracking (Play mode), and pet-to-approve.
import type * as THREE from 'three';
import type { BusEvent, Mode } from '@fetch/contracts';
import type { FeedItem } from './species';

export interface InteractionHost {
  hitPet(x: number, y: number): boolean;
  hitBall(x: number, y: number): boolean;
  toWorld(x: number, y: number): THREE.Vector3 | undefined;
  emit(e: BusEvent): void;
  react(kind: 'pet' | 'poke' | 'feed'): void;
  petted(intensity: number, dt: number): void;
  feed(item: FeedItem): boolean; // false if the species won't eat it
  holdBall(x: number, y: number): void;
  releaseBall(vx: number, vy: number): void;
  point(x: number, z?: number): void;
  dragPet?(x: number, z: number, drop: boolean): void;
  cursor(x: number, y: number): void;
  approval(): { pending: boolean; actionId: string };
  setRing(p: number): void;
  mode(): Mode;
  isGestureClaimed?(pointerId: number): boolean;
  petPosition?(): { x: number; z: number };
}

export const APPROVE_SECS = 1.2; // continuous stroke needed to pet-to-approve

export class Interactions {
  private down?: { x: number; y: number; t: number; path: number; onPet: boolean; ball: boolean; startWorld?: { x: number; z: number }; startPet?: { x: number; z: number }; dragTarget?: { x: number; z: number } };
  private last = { x: 0, y: 0, t: 0 };
  private speed = 0;      // px/ms, smoothed
  private revs: number[] = []; // timestamps of direction reversals (x)
  private dirX = 0;
  private suppressClickUntil = 0;
  private strokeEmit = 0;
  private strokeT = 0;     // ms since last stroke motion
  private ring = 0;        // seconds of continuous approving stroke
  private locked = false;  // APPROVE already fired for this pending approval
  private flick: { x: number; y: number; t: number }[] = [];

  constructor(private h: InteractionHost) {
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('application/x-fetch-food')) e.preventDefault(); });
    window.addEventListener('drop', e => {
      const item = e.dataTransfer?.getData('application/x-fetch-food') as FeedItem | undefined;
      if (item) { e.preventDefault(); this.dropFood(item, e.clientX, e.clientY); }
    });
    window.addEventListener('click', e => {
      // F2 normally sends POINT itself; when the click lands on the bare page, do it here
      const t = e.target as HTMLElement;
      if ((t === document.body || t === document.documentElement) && !this.down?.onPet && performance.now() > this.suppressClickUntil) this.point(e.clientX, e.clientY);
    });
  }

  /** F2's treat tray calls this on drop (or uses the HTML5 drop above). Returns true if it landed on the pet. */
  dropFood(item: FeedItem, x: number, y: number) {
    if (!this.h.hitPet(x, y)) return false;
    if (!this.h.feed(item)) return false;
    this.h.emit({ type: 'FEED', item });
    this.h.react('feed');
    return true;
  }

  point(x: number, y: number) {
    const w = this.h.toWorld(x, y);
    if (!w) return;
    const floorZ = Math.abs(w.z) > 1e-5 ? w.z : w.y;
    this.h.emit({ type: 'POINT', x: w.x, y: floorZ });
    this.h.point(w.x, floorZ);
  }

  private onDown = (e: PointerEvent) => {
    const onPet = this.h.hitPet(e.clientX, e.clientY), ball = !onPet && this.h.hitBall(e.clientX, e.clientY);
    if (!onPet && !ball && this.h.isGestureClaimed?.(e.pointerId)) { this.down = undefined; return; }
    const startWorld = onPet ? this.h.toWorld(e.clientX, e.clientY) : undefined;
    const pet = onPet ? this.h.petPosition?.() : undefined;
    this.down = { x: e.clientX, y: e.clientY, t: e.timeStamp, path: 0, onPet, ball, startWorld: startWorld ? { x: startWorld.x, z: Math.abs(startWorld.z) > 1e-5 ? startWorld.z : startWorld.y } : undefined, startPet: pet };
    this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    this.speed = 0; this.revs = []; this.dirX = 0; this.flick = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
  };

  private onMove = (e: PointerEvent) => {
    const w = this.h.toWorld(e.clientX, e.clientY);
    if (w) this.h.cursor(w.x, w.y);
    const d = this.down;
    if (!d) return;
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y, dt = Math.max(1, e.timeStamp - this.last.t);
    d.path += Math.hypot(dx, dy);
    this.speed = this.speed * 0.6 + (Math.hypot(dx, dy) / dt) * 0.4;
    if (Math.abs(dx) > 3) { const s = Math.sign(dx); if (this.dirX && s !== this.dirX) this.revs.push(e.timeStamp); this.dirX = s; }
    this.revs = this.revs.filter(t => e.timeStamp - t < 1000);
    this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (d.ball && w) { this.h.holdBall(w.x, Math.abs(w.z) > 1e-5 ? w.z : w.y); this.flick.push({ x: e.clientX, y: e.clientY, t: e.timeStamp }); this.flick = this.flick.filter(f => e.timeStamp - f.t < 100); }
    if (d.onPet) {
      this.strokeT = 0;
      if (d.path > 12 && w) {
        const z = Math.abs(w.z) > 1e-5 ? w.z : w.y;
        const start = d.startWorld, pet = d.startPet;
        const scale = .5;
        const x = pet && start ? pet.x + (w.x - start.x) * scale : w.x;
        const targetZ = pet && start ? pet.z + (z - start.z) * scale : z;
        d.dragTarget = { x, z: targetZ };
        this.h.dragPet?.(x, targetZ, false);
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = undefined;
    if (!d) return;
    if (d.path >= 12) this.suppressClickUntil = performance.now() + 250;
    if (d.ball) {
      // flick velocity from the last ~100ms of motion, px/s -> world units/s (stage is ~2.8 units tall)
      const a = this.flick[0], b = this.flick[this.flick.length - 1];
      const dt = Math.max(16, b.t - a.t) / 1000;
      const k = 2.8 / innerHeight;
      const vx = ((b.x - a.x) / dt) * k, vy = (-(b.y - a.y) / dt) * k;
      const cl = (v: number) => Math.max(-12, Math.min(12, v));
      this.h.releaseBall(cl(vx), cl(vy));
      this.h.emit({ type: 'THROW', vx: cl(vx), vy: cl(vy) });
      return;
    }
    if (d.onPet && d.path >= 12) {
      const p = d.dragTarget ?? this.h.petPosition?.();
      if (p) this.h.dragPet?.(p.x, p.z, true);
      return;
    }
    if (d.onPet && d.path < 6 && e.timeStamp - d.t < 400) { this.h.emit({ type: 'POKE' }); this.h.react('poke'); }
  };

  /** Call every frame with seconds elapsed. */
  update(dt: number, now: number) {
    const d = this.down;
    this.strokeT += dt * 1000;
    const overPet = !!d?.onPet && this.h.hitPet(this.last.x, this.last.y);
    const stroking = overPet && this.revs.length >= 1 && this.strokeT < 250 && this.speed > 0.05;
    if (stroking) {
      const intensity = Math.min(1, this.speed / 1.0);
      this.h.petted(intensity, dt);
      if (now - this.strokeEmit > 100) {
        this.strokeEmit = now;
        this.h.emit({ type: 'PET_STROKE', intensity });
      }
      if (now - this.strokeEmit < 16 && this.revs.length) this.h.react('pet');
    }
    // Pet-to-approve: only while an approval card is pending; continuous stroke; leaving the pet resets.
    const ap = this.h.approval();
    if (!ap.pending) { this.locked = false; this.ring = 0; this.h.setRing(0); return; }
    if (this.locked) return;
    if (stroking) this.ring += dt; else this.ring = 0; // pause or leave = reset
    this.h.setRing(Math.min(1, this.ring / APPROVE_SECS));
    if (this.ring >= APPROVE_SECS) {
      this.locked = true; this.ring = 0; this.h.setRing(0);
      this.h.emit({ type: 'APPROVE', actionId: ap.actionId });
    }
  }
}
