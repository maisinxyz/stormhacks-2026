// Photo -> plush traits, without any AI service: only the coat COLOURS come from the photo (k-means on the middle
// of the image). The shape stays the default plush dog.
// ponytail: colours only. Ear type, snout length and build need a vision model or silhouette fitting (play.md B.14,
// open decision); when that lands it fills the same PlushTraits numbers.
import { DEFAULT_PLUSH, type PlushTraits } from './sdfPet';

type RGB = [number, number, number];
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (c: RGB) => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Coat palette from RGBA pixels (the centre of the picture, where the dog usually is). Exported for the self-check. */
export function coatPalette(data: Uint8ClampedArray, w: number, h: number) {
  const px: RGB[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5, i = (y * w + x) * 4;
    if (dx * dx + dy * dy < 0.38 * 0.38 && data[i + 3] > 128) px.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!px.length) return undefined;
  // k-means, k=3, seeded from the darkest / middle / lightest pixel so the result is deterministic
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  let cent: RGB[] = [sorted[0], sorted[sorted.length >> 1], sorted[sorted.length - 1]].map(c => [...c] as RGB);
  let count = [0, 0, 0];
  for (let it = 0; it < 8; it++) {
    const sum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; count = [0, 0, 0];
    for (const p of px) {
      let best = 0, bd = Infinity;
      cent.forEach((c, k) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = k; } });
      sum[best][0] += p[0]; sum[best][1] += p[1]; sum[best][2] += p[2]; count[best]++;
    }
    cent = cent.map((c, k) => count[k] ? [sum[k][0] / count[k], sum[k][1] / count[k], sum[k][2] / count[k]] as RGB : c);
  }
  const order = [0, 1, 2].filter(k => count[k] > 0);
  const base = cent[order.reduce((a, b) => count[b] > count[a] ? b : a)];
  const lightest = cent[order.reduce((a, b) => lum(cent[b]) > lum(cent[a]) ? b : a)];
  const darkest = cent[order.reduce((a, b) => lum(cent[b]) < lum(cent[a]) ? b : a)];
  const white: RGB = [255, 248, 235], dark: RGB = [40, 28, 22];
  // plush softening; and make sure the light and dark accents really differ from the base
  const soft = (c: RGB) => mix(c, white, 0.1);
  return {
    base: soft(base),
    light: soft(lum(lightest) - lum(base) > 18 ? lightest : mix(base, white, 0.45)),
    dark: soft(lum(base) - lum(darkest) > 18 ? darkest : mix(base, dark, 0.3)),
  };
}

export async function plushFromPhoto(image: Blob, from: PlushTraits = DEFAULT_PLUSH): Promise<PlushTraits> {
  const bmp = await createImageBitmap(image), c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, 64, 64);
  const p = coatPalette(g.getImageData(0, 0, 64, 64).data, 64, 64);
  if (!p) return from;
  const light = hex(p.light);
  return { ...from, colors: { ...from.colors, base: hex(p.base), ear: hex(p.dark), belly: light, muzzle: light, paws: light, tailTip: light } };
}
