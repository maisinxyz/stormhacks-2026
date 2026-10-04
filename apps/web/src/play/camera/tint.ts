// play.md B.8: make the dog sit in the scene. Samples the camera frame's average colour and brightness twice a second,
// tints the splats toward the room's colour temperature and softens the contact shadow in dim scenes.
// Limits (stated in play.md): no occlusion and no real lighting, only this global tint.
import type { Engine } from '../../engine';

const STRENGTH = 0.22; // how far the dog's colour moves toward the scene's colour cast
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class AmbientTint {
  private c = document.createElement('canvas');
  private x = this.c.getContext('2d', { willReadFrequently: true })!;
  private since = 1;
  private target = [1, 1, 1];
  private cur = [1, 1, 1];
  private shadow = 1;
  private shadowCur = 1;
  private dead = false;
  /** Latest scene luminance 0..1 (for tests / debugging). */
  lum = 0.5;

  constructor(private video: HTMLVideoElement, private engine: Engine) { this.c.width = this.c.height = 16; }

  private sample() {
    if (this.dead || this.video.readyState < 2) return;
    try {
      this.x.drawImage(this.video, 0, 0, 16, 16);
      const d = this.x.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4 * 255;
      r /= n; g /= n; b /= n;
      const lum = (this.lum = 0.2126 * r + 0.7152 * g + 0.0722 * b), mean = (r + g + b) / 3 || 1;
      const bright = 1 + (clamp(lum / 0.45, 0.55, 1.15) - 1) * 0.5; // dim room -> slightly darker dog
      this.target = [r, g, b].map(v => (1 + (v / mean - 1) * STRENGTH) * bright);
      this.shadow = clamp(0.35 + lum * 0.9, 0.35, 1);               // darker video -> softer shadow
    } catch { this.dead = true; } // cross-origin video taints the canvas: leave the dog untinted
  }

  update(dt: number) {
    if ((this.since += dt) >= 0.5) { this.since = 0; this.sample(); }
    const k = Math.min(1, dt * 2); // low-pass so the colour never pops
    this.cur = this.cur.map((v, i) => v + (this.target[i] - v) * k);
    this.shadowCur += (this.shadow - this.shadowCur) * k;
    this.engine.setTint(this.cur[0], this.cur[1], this.cur[2]);
    this.engine.setShadowOpacity(this.shadowCur);
  }

  reset() {
    this.target = [1, 1, 1]; this.cur = [1, 1, 1]; this.shadow = this.shadowCur = 1;
    this.engine.setTint(1, 1, 1); this.engine.setShadowOpacity(1);
  }
}
