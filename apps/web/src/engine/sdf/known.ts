// Hard-coded plush dogs: each one is modelled by hand from a photo, and uploading that same photo returns it
// (camera "My dog photo" and the generate pipeline both ask here first). Any other photo takes the normal path.
import type { PetBundle } from '@fetch/contracts';
import type { PlushTraits } from './sdfPet';

export interface KnownDog { id: string; name: string; photo: string; traits: PlushTraits }

export const KNOWN_DOGS: KnownDog[] = [
  {
    // rottweiler: black coat with tan points (muzzle, eyebrow dots, chest, lower legs), broad head, small folded ears, deep chest, docked tail
    id: 'rottweiler', name: 'Tank', photo: new URL('./known/rottweiler.png', import.meta.url).href,
    traits: {
      bodyLength: 0.9, girth: 0.31, legLength: 0.27, headSize: 0.29, snout: 0.14, earShape: 0, earSize: 0.85, tailLength: 0.1, tailUp: 0.35,
      points: '#B0652B',
      colors: { base: '#221E1F', belly: '#2B2523', ear: '#171415', muzzle: '#B0652B', paws: '#B0652B', tailTip: '#221E1F', nose: '#0C0A0A', eye: '#2A160B' },
    },
  },
  {
    // smooth red dachshund: long low body, short legs, long muzzle, big hanging ears, long low tail, one coat colour
    id: 'dachshund', name: 'Frank', photo: new URL('./known/dachshund.png', import.meta.url).href,
    traits: {
      bodyLength: 1.15, girth: 0.22, legLength: 0.16, headSize: 0.24, snout: 0.24, earShape: 0, earSize: 1.4, tailLength: 0.33, tailUp: 0.2,
      colors: { base: '#9A4A27', belly: '#B26A3E', ear: '#753419', muzzle: '#A85C34', paws: '#B26A3E', tailTip: '#84401F', nose: '#2A1C18', eye: '#120C0A' },
    },
  },
];

const N = 8;
/** An 8x8 colour thumbnail of the picture: the same photo re-saved, resized or re-compressed gives nearly the same numbers. */
async function fingerprint(image: Blob): Promise<number[]> {
  const bmp = await createImageBitmap(image), c = document.createElement('canvas'), S = 64, B = S / N;
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data, out = new Array<number>(N * N * 3).fill(0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = ((y / B | 0) * N + (x / B | 0)) * 3, i = (y * S + x) * 4;
    for (let k = 0; k < 3; k++) out[o + k] += d[i + k] / (B * B);
  }
  return out;
}

/** Mean colour difference per cell, 0..255. The same photo scores about 0 to 5; a different photo scores 30 or more. */
const distance = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const SAME = 12;

let prints: Promise<number[][]> | undefined;
/** The hard-coded dog made from this photo, if it is one of the known photos. */
export async function knownDog(image: Blob): Promise<KnownDog | undefined> {
  try {
    prints ??= Promise.all(KNOWN_DOGS.map(async k => fingerprint(await (await fetch(k.photo)).blob())));
    const [mine, theirs] = await Promise.all([fingerprint(image), prints]);
    return KNOWN_DOGS.find((_, i) => distance(mine, theirs[i]) < SAME);
  } catch { prints = undefined; return undefined; } // unreadable picture: let the normal path report it
}

/** A complete bundle for a hard-coded dog (plush pets carry traits, not files). */
export function knownBundle(k: KnownDog, name = k.name): PetBundle {
  return {
    id: `known-${k.id}`, name, species: 'dog', splatUrl: '', rigUrl: '', weightsUrl: '', thumbnailUrl: k.photo,
    plush: k.traits as unknown as Record<string, unknown>,
    personality: { eager: 0.8, sassy: 0.5, anxious: 0.2, chatty: 0.5 }, stats: { energy: 100, happiness: 80, hunger: 0 }, createdAt: new Date().toISOString(),
  };
}

