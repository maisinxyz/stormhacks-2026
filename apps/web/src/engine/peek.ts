// PRD 1.9 edge-peek scene: a small second canvas showing the pet working while it is off the main canvas.
// Per-species scene (bush / ledge / burrow / nest), 80k-splat LOD. F2 owns the dock container and expandable log;
// this renders inside the canvas F2 hands to Engine.mount(canvas, peekCanvas).
import * as THREE from 'three';
import type { ActionStep, Mood, RunEvent } from '@fetch/contracts';
import { Animator, applyMood, type Clip } from './anim';
import { Props, propSprite, type Prop } from './props';
import { Skeleton, type Bone } from './skeleton';
import type { SpeciesPack } from './species';
import { SplatMesh } from './splatRenderer';

export const PEEK_BUDGET = 80_000;
const PILE_CAP = 16;

function art(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  return new THREE.CanvasTexture(c);
}

// Occluders hide the body so only the telltale part shows (tail / wings / dirt).
const OCCLUDERS: Record<SpeciesPack['peek']['scene'], { tex: () => THREE.Texture; size: [number, number]; at: [number, number] }> = {
  bush: { size: [1.8, 1.15], at: [0, 0.4], tex: () => art(256, 144, x => {
    for (const [cx, cy, r, col] of [[70, 90, 60, '#2f7d3a'], [130, 70, 70, '#3b9246'], [190, 92, 58, '#2f7d3a'], [128, 100, 70, '#357f3f']] as const) {
      x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
  }) },
  ledge: { size: [1.7, 0.85], at: [0, 0.28], tex: () => art(256, 128, x => {
    x.fillStyle = '#8b8f98'; x.fillRect(0, 20, 256, 108); x.fillStyle = '#b9bdc6'; x.fillRect(0, 12, 256, 16);
    x.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 256; i += 64) x.fillRect(i, 28, 2, 100);
  }) },
  nest: { size: [1.4, 0.65], at: [0, 0.2], tex: () => art(256, 120, x => {
    x.fillStyle = '#8a5a2b'; x.beginPath(); x.ellipse(128, 70, 120, 48, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#c99a5b'; x.lineWidth = 3;
    for (let i = 0; i < 28; i++) { x.beginPath(); x.moveTo(20 + Math.random() * 216, 40 + Math.random() * 60); x.lineTo(20 + Math.random() * 216, 40 + Math.random() * 60); x.stroke(); }
  }) },
  burrow: { size: [1.3, 0.55], at: [0, 0.1], tex: () => art(256, 110, x => {
    x.fillStyle = '#4a3320'; x.beginPath(); x.ellipse(128, 70, 118, 36, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#16100a'; x.beginPath(); x.ellipse(128, 66, 70, 22, 0, 0, Math.PI * 2); x.fill();
  }) },
};

const moundTex = () => art(128, 80, x => {
  x.fillStyle = '#6b4a2b'; x.beginPath(); x.moveTo(0, 80); x.quadraticCurveTo(64, -30, 128, 80); x.fill();
});

export class PeekScene {
  readonly log: string[] = []; // one entry per reaction; tests compare against the incoming event stream
  active = false;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  private splat: SplatMesh;
  private sk: Skeleton;
  private anim = new Animator();
  private fx: Props;
  private pile: { s: THREE.Sprite; vx: number }[] = [];
  private mound?: THREE.Sprite;
  private items = 0;
  private verbClips: string[] = [];
  private clipIdx = 0;
  private clipT = 0;
  private mood: Mood = 'neutral';
  private worriedUntil = 0;
  private interlude?: { clip: string; until: number }; // tail-wag burst etc.
  private pushT = 0;
  private closing = false;
  private t = 0;

  constructor(private canvas: HTMLCanvasElement, private pack: SpeciesPack, splat: ArrayBuffer, weights: ArrayBuffer, bones: Bone[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0.62, 3.6);
    this.camera.lookAt(0, 0.55, 0);
    this.splat = new SplatMesh(splat, weights);
    this.splat.setBudget(PEEK_BUDGET);
    this.splat.mesh.position.set(0, pack.peek.y, 0);
    this.splat.mesh.rotation.y = pack.peek.yaw;
    this.splat.mesh.visible = !pack.peek.hidden;
    this.scene.add(this.splat.mesh);
    this.sk = new Skeleton(bones);
    const o = OCCLUDERS[pack.peek.scene];
    const occ = new THREE.Sprite(new THREE.SpriteMaterial({ map: o.tex(), transparent: true, depthTest: false }));
    occ.scale.set(o.size[0], o.size[1], 1); occ.position.set(o.at[0], o.at[1], 0.5); occ.renderOrder = 5;
    this.scene.add(occ);
    this.fx = new Props(this.scene);
    canvas.style.display = 'none';
  }

  setActive(on: boolean) {
    if (on) {
      this.closing = false; this.active = true;
      this.canvas.style.display = 'block';
      this.splat.mesh.visible = !this.pack.peek.hidden;
      return;
    }
    if (!this.active) return;
    // let the pile get pushed out first if a result is in flight; otherwise hide now
    if (this.pushT > 0) this.closing = true; else this.hide();
  }

  private hide() { this.active = false; this.closing = false; this.canvas.style.display = 'none'; this.clearPile(); }

  private clearPile() {
    this.pile.forEach(p => this.scene.remove(p.s));
    this.pile = []; this.items = 0; this.pushT = 0;
    if (this.mound) { this.scene.remove(this.mound); this.mound = undefined; }
  }

  private setVerb(step?: Pick<ActionStep, 'verb' | 'mood'>) {
    const verb = step?.verb ?? 'WAIT';
    this.verbClips = this.pack.verbs[verb].clips;
    this.clipIdx = 0; this.clipT = 0;
    this.mood = step?.mood ?? 'neutral';
    this.play(this.verbClips[0]);
  }

  private play(name: string) { this.anim.play(this.pack.clips[name] ?? this.pack.clips.stand, 1, 0.15); }

  private addPile(prop?: Prop) {
    this.items++;
    if (this.pack.peek.scene === 'burrow') {
      if (!this.mound) { this.mound = new THREE.Sprite(new THREE.SpriteMaterial({ map: moundTex(), transparent: true, depthTest: false })); this.mound.renderOrder = 6; this.scene.add(this.mound); }
      const k = 0.25 + Math.min(this.items, PILE_CAP) * 0.045;
      this.mound.scale.set(k * 1.6, k, 1); this.mound.position.set(-0.5, 0.04 + k / 2, 0.6);
      return;
    }
    if (this.pile.length >= PILE_CAP) return;
    const i = this.pile.length;
    const s = propSprite(prop ?? { kind: 'preset', name: 'document' }, 0.22);
    s.position.set(-0.6 + (i % 4) * 0.12 + Math.random() * 0.03, 0.08 + Math.floor(i / 4) * 0.09, 0.6 + i * 0.001);
    s.renderOrder = 7 + i;
    this.scene.add(s);
    this.pile.push({ s, vx: 0 });
  }

  /** Map one run event to its peek reaction (PRD 1.9 table). `step` resolves the stepId from the current plan. */
  handle(e: RunEvent, step?: (id: string) => ActionStep | undefined) {
    const now = this.t;
    switch (e.type) {
      case 'run.plan': this.clearPile(); this.setVerb(e.steps[0]); this.log.push('plan'); break;
      case 'tool.start': {
        const st = step?.(e.stepId);
        this.fx.burst(this.pack.verbs[st?.verb ?? 'SEARCH'].particle ?? 'puff', new THREE.Vector3(0, 0.5, 0.7), 8); // dust / feather / dirt puff
        this.interlude = undefined;
        this.setVerb(st);
        this.log.push('start'); break;
      }
      case 'tool.progress': this.addPile(step?.(e.stepId)?.prop); this.log.push('pile'); break; // pile grows by one
      case 'tool.retry': this.worriedUntil = now + 1.5; this.log.push('retry'); break;           // ear-droop / feather-ruffle
      case 'tool.end':
        if (e.ok) { this.fx.burst('puff', new THREE.Vector3(0, 0.9, 0.7), 6); this.interlude = { clip: this.pack.peek.wag, until: now + 1.2 }; this.play(this.pack.peek.wag); }
        else { this.interlude = { clip: this.pack.verbs.FAIL.clips[0], until: now + 1.2 }; this.play(this.pack.verbs.FAIL.clips[0]); }
        this.log.push(e.ok ? 'end-ok' : 'end-fail'); break;
      case 'run.result': case 'run.error': case 'run.cancelled': case 'approval.required':
        this.pushT = 1; this.pile.forEach(p => { p.vx = 1.6 + Math.random() * 0.6; }); // pile pushed out; pet returns on the main canvas
        this.log.push('push'); break;
    }
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    // advance the verb loop; interludes (wag, fail) hold for a moment then resume
    if (this.interlude && this.t > this.interlude.until) { this.interlude = undefined; this.play(this.verbClips[this.clipIdx] ?? 'stand'); }
    if (!this.interlude && this.verbClips.length) {
      const c: Clip = this.pack.clips[this.verbClips[this.clipIdx]] ?? this.pack.clips.stand;
      this.clipT += dt;
      if (this.clipT > c.dur * (c.loop ? 2 : 1)) { this.clipT = 0; this.clipIdx = (this.clipIdx + 1) % this.verbClips.length; this.play(this.verbClips[this.clipIdx]); }
    }
    const pose = applyMood(this.anim.update(dt), this.t < this.worriedUntil ? 'worried' : this.mood);
    this.sk.reset();
    for (const [n, e] of Object.entries(pose.bones)) this.sk.setEuler(n, e[0], e[1], e[2]);
    this.splat.mesh.position.y = this.pack.peek.y + (pose.y ?? 0);
    this.sk.update(this.splat.uniforms.uBones.value);
    if (this.pushT > 0) {
      this.pushT -= dt;
      this.pile.forEach(p => { p.s.position.x += p.vx * dt; p.s.material.opacity = Math.max(0, this.pushT); });
      if (this.mound) this.mound.position.x += 1.6 * dt;
      if (this.pushT <= 0) { this.clearPile(); if (this.closing) this.hide(); }
    }
    this.fx.update(dt);
    const w = this.canvas.clientWidth || 160, h = this.canvas.clientHeight || 160;
    if (this.canvas.width !== Math.round(w * devicePixelRatio) || this.canvas.height !== Math.round(h * devicePixelRatio)) {
      this.renderer.setPixelRatio(devicePixelRatio); this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    this.splat.mesh.updateMatrixWorld();
    this.splat.update(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
