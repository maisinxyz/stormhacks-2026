// Hard-coded plush dogs: each one is modelled by hand from a photo, and uploading that same photo returns it
// (camera "My dog photo" and the generate pipeline both ask here first). Any other photo takes the normal path.
import type { PetBundle } from '@fetch/contracts';
import type { PlushTraits } from './sdfPet';

export interface KnownDog { id: string; name: string; photo: string; traits: PlushTraits }

// The photos live in the repo's top-level assets/ folder.
export const KNOWN_DOGS: KnownDog[] = [
  {
    // smooth red dachshund: long low body, short legs, long muzzle, big hanging ears, long low tail, one coat colour
    id: 'dachshund', name: 'Frank', photo: new URL('../../../../../assets/dachshund.png', import.meta.url).href,
    traits: {
      bodyLength: 1.15, girth: 0.22, legLength: 0.16, headSize: 0.24, snout: 0.24, earShape: 0, earSize: 1.4, tailLength: 0.33, tailUp: 0.2,
      colors: { base: '#9A4A27', belly: '#B26A3E', ear: '#753419', muzzle: '#A85C34', paws: '#B26A3E', tailTip: '#84401F', nose: '#2A1C18', eye: '#120C0A' },
    },
  },
  {
    // German shepherd: tan coat with a black saddle, black muzzle and tail, tall pointed ears, deep chest, bushy tail carried low
    id: 'german-shepherd', name: 'Rex', photo: new URL('../../../../../assets/germanShepard.png', import.meta.url).href,
    traits: {
      bodyLength: 0.98, girth: 0.28, legLength: 0.3, headSize: 0.25, snout: 0.19, earShape: 1, earSize: 1.45, tailLength: 0.42, tailUp: 0.12, size: 1.3,
      saddle: '#1F1D20',
      colors: { base: '#B9733A', belly: '#C98B4E', ear: '#2A1D16', muzzle: '#201A18', paws: '#C47A36', tailTip: '#26211F', nose: '#0C0A0A', eye: '#2A160B' },
    },
  },
  {
    // Rottweiler: black coat with tan muzzle and feet, broad head, short muzzle, small folded ears, heavy build, stub tail
    id: 'rottweiler', name: 'Bruno', photo: new URL('../../../../../assets/rottweiler.png', import.meta.url).href,
    traits: {
      bodyLength: 0.9, girth: 0.31, legLength: 0.27, headSize: 0.28, snout: 0.14, earShape: 0.08, earSize: 0.8, tailLength: 0.1, tailUp: 0.5, size: 1.15,
      colors: { base: '#2B2526', belly: '#332A28', ear: '#1E1A1A', muzzle: '#B26A32', paws: '#B26A32', tailTip: '#2B2526', nose: '#0C0A0A', eye: '#2A160B' },
    },
  },
  {
    // yellow Labrador / golden retriever: pale cream coat, lighter chest and feet, hanging ears a shade darker, pinkish-brown nose, athletic build
    id: 'golden-retriever', name: 'Sunny', photo: new URL('../../../../../assets/goldenRetriever.png', import.meta.url).href,
    traits: {
      bodyLength: 0.95, girth: 0.27, legLength: 0.32, headSize: 0.26, snout: 0.17, earShape: 0, earSize: 1, tailLength: 0.36, tailUp: 0.25, size: 1.2,
      colors: { base: '#EBCB9A', belly: '#F6E6C8', ear: '#D6AA70', muzzle: '#F3E0BF', paws: '#F8ECD6', tailTip: '#E2BB85', nose: '#8A5A50', eye: '#2A160B' },
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

