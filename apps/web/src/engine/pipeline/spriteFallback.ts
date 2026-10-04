// PRD 1.2 fallback: when image-to-3D fails or scores low, build a 2.5D cutout from the segmented image.
// Every opaque pixel becomes a thin splat in the pet's side plane, so the SAME rig template, skin weights and clips
// apply (head/body/legs/tail/wings are just regions of the cutout bound to the template bones).
// ponytail: assumes the subject faces right in the image (maps to +Z); add a flip toggle / facing detection when needed.
import type { Species } from '@fetch/contracts';
import type { Gaussians } from './gaussians';

export async function spriteToGaussians(alphaPng: Blob, _species: Species, budget: number, rows = 150): Promise<Gaussians> {
  const bmp = await createImageBitmap(alphaPng);
  const h = rows, w = Math.max(1, Math.round((bmp.width / bmp.height) * rows));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(bmp, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data;
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (px[(j * w + i) * 4 + 3] > 128) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j); }
  if (x1 < x0) throw new Error('empty segmentation');
  const k = 1 / (y1 - y0 + 1), cx = (x0 + x1) / 2;
  const keep: number[] = [];
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (px[(j * w + i) * 4 + 3] > 128) keep.push(j * w + i);
  const stride = Math.max(1, Math.ceil(keep.length / budget)); // stays under budget for huge crops
  const n = Math.ceil(keep.length / stride);
  const g: Gaussians = { n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3), rgba: new Uint8Array(n * 4), rot: new Float32Array(n * 4) };
  for (let m = 0; m < n; m++) {
    const p = keep[m * stride], i = p % w, j = (p / w) | 0;
    g.pos.set([(Math.random() - 0.5) * 0.01, (y1 - j) * k, (i - cx) * k], m * 3);  // image x -> +Z, image y -> up, feet at y=0
    g.scale.set([0.006, 0.6 * k * Math.sqrt(stride), 0.6 * k * Math.sqrt(stride)], m * 3); // disks facing the side camera
    g.rgba.set([px[p * 4], px[p * 4 + 1], px[p * 4 + 2], 255], m * 4);
    g.rot.set([1, 0, 0, 0], m * 4);
  }
  return g;
}
