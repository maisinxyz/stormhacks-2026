// Props (preset emoji stickers + generated PNG stickers) and tiny particle bursts.
import * as THREE from 'three';
import type { ActionStep } from '@fetch/contracts';
import type { ParticleKind } from './species';

export type Prop = NonNullable<ActionStep['prop']>;

const PRESET: Record<string, string> = {
  envelope: '✉️', document: '📄', folder: '📁', magnifier: '🔍', keyboard: '⌨️', pencil: '✏️',
  calendar: '📅', phone: '📱', coin: '🪙', box: '📦', ball: '🎾',
};
const texCache = new Map<string, THREE.Texture>();

function propTexture(p: Prop): THREE.Texture {
  const key = p.kind === 'generated' && p.imageUrl ? p.imageUrl : `preset:${p.name}`;
  let t = texCache.get(key);
  if (t) return t;
  if (p.kind === 'generated' && p.imageUrl) {
    t = new THREE.TextureLoader().load(p.imageUrl);
  } else {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.font = '96px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(PRESET[p.name] ?? '📦', 64, 70); // unknown preset names fall back to the box
    t = new THREE.CanvasTexture(c);
  }
  texCache.set(key, t);
  return t;
}

const COLORS: Record<ParticleKind, number> = { dust: 0xb9a98c, feather: 0xffffff, dirt: 0x6b4a2b, puff: 0xfff3c4 };

export function propSprite(p: Prop, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: propTexture(p), transparent: true, depthTest: false }));
  s.scale.set(size, size, 1);
  s.renderOrder = 10;
  return s;
}

export class Props {
  private carry?: THREE.Sprite;
  private world?: THREE.Sprite;
  private parts: { s: THREE.Sprite; v: THREE.Vector3; life: number }[] = [];
  private dot: THREE.Texture;

  constructor(private scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    this.dot = new THREE.CanvasTexture(c);
  }

  private sprite(p: Prop, size: number) {
    const s = propSprite(p, size);
    this.scene.add(s);
    return s;
  }

  setCarry(p?: Prop) {
    if (this.carry) { this.scene.remove(this.carry); this.carry = undefined; }
    if (p) this.carry = this.sprite(p, 0.22);
  }
  get carrying() { return !!this.carry; }

  setWorld(p: Prop | undefined, at?: THREE.Vector3) {
    if (this.world) { this.scene.remove(this.world); this.world = undefined; }
    if (p && at) { this.world = this.sprite(p, 0.3); this.world.position.copy(at); }
  }

  burst(kind: ParticleKind, at: THREE.Vector3, n = 10) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, color: COLORS[kind], transparent: true, depthTest: false }));
      s.position.copy(at); s.scale.setScalar(kind === 'feather' ? 0.07 : 0.1); s.renderOrder = 9;
      this.scene.add(s);
      const up = kind === 'feather' ? 0.4 : 0.8;
      this.parts.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * up, (Math.random() - 0.5) * 0.5), life: 0.8 });
    }
  }

  update(dt: number, socket?: THREE.Vector3) {
    if (this.carry) { if (socket) this.carry.position.copy(socket); this.carry.visible = !!socket; }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.s.position.addScaledVector(p.v, dt);
      p.v.y -= (p.s.material.color.getHex() === COLORS.feather ? 0.3 : 1.5) * dt;
      p.s.material.opacity = Math.max(0, p.life / 0.8);
      if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); this.parts.splice(i, 1); }
    }
  }
}
