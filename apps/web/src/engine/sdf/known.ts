// Hard-coded plush pets (dogs and cats): each one is modelled by hand from a photo, and uploading that same photo returns it
// (camera "My dog photo" and the generate pipeline both ask here first). Any other photo takes the normal path.
import type { PetBundle } from '@fetch/contracts';
import type { PlushTraits } from './sdfPet';

export interface KnownDog { id: string; name: string; species: 'dog' | 'cat'; photo: string; traits: PlushTraits }

// The photos live in the repo's top-level assets/ folder.
export const KNOWN_DOGS: KnownDog[] = [
  {
    // smooth red dachshund: long low body, short legs, long muzzle, big hanging ears, long low tail, one coat colour
    id: 'dachshund', name: 'Frank', species: 'dog', photo: new URL('../../../../../assets/dachshund.png', import.meta.url).href,
    traits: {
      bodyLength: 1.15, girth: 0.22, legLength: 0.16, headSize: 0.24, snout: 0.24, earShape: 0, earSize: 1.4, tailLength: 0.33, tailUp: 0.2,
      colors: { base: '#9A4A27', belly: '#B26A3E', ear: '#753419', muzzle: '#A85C34', paws: '#B26A3E', tailTip: '#84401F', nose: '#2A1C18', eye: '#120C0A' },
    },
  },
  {
    // German shepherd: tan coat with a black saddle, black muzzle and tail, tall pointed ears, deep chest, bushy tail carried low
    id: 'german-shepherd', name: 'Rex', species: 'dog', photo: new URL('../../../../../assets/germanShepard.png', import.meta.url).href,
    traits: {
      bodyLength: 0.98, girth: 0.28, legLength: 0.3, headSize: 0.25, snout: 0.19, earShape: 1, earSize: 1.45, tailLength: 0.42, tailUp: 0.12, size: 1.3,
      saddle: '#1F1D20',
      colors: { base: '#B9733A', belly: '#C98B4E', ear: '#2A1D16', muzzle: '#201A18', paws: '#C47A36', tailTip: '#26211F', nose: '#0C0A0A', eye: '#2A160B' },
    },
  },
  {
    // Rottweiler: black coat with tan muzzle and feet, broad head, short muzzle, small folded ears, heavy build, stub tail
    id: 'rottweiler', name: 'Bruno', species: 'dog', photo: new URL('../../../../../assets/rottweiler.png', import.meta.url).href,
    traits: {
      bodyLength: 0.9, girth: 0.31, legLength: 0.27, headSize: 0.28, snout: 0.14, earShape: 0.12, earSize: 1.1, tailLength: 0.1, tailUp: 0.5, size: 1.15,
      colors: { base: '#2B2526', belly: '#332A28', ear: '#443A3B', muzzle: '#B26A32', paws: '#B26A32', tailTip: '#2B2526', nose: '#0C0A0A', eye: '#2A160B' },
    },
  },
  {
    // yellow Labrador / golden retriever: pale cream coat, lighter chest and feet, hanging ears a shade darker, pinkish-brown nose, athletic build
    id: 'golden-retriever', name: 'Sunny', species: 'dog', photo: new URL('../../../../../assets/goldenRetriever.png', import.meta.url).href,
    traits: {
      bodyLength: 0.95, girth: 0.27, legLength: 0.32, headSize: 0.26, snout: 0.17, earShape: 0, earSize: 1, tailLength: 0.36, tailUp: 0.25, size: 1.2,
      colors: { base: '#EBCB9A', belly: '#F6E6C8', ear: '#D6AA70', muzzle: '#F3E0BF', paws: '#F8ECD6', tailTip: '#E2BB85', nose: '#8A5A50', eye: '#2A160B' },
    },
  },
  // Cats: the same plush body with a flat face, small upright ears and a long tail carried up.
  {
    // orange tabby: ginger coat, darker ginger along the back, cream chin and feet, white tail tip, pink nose, green eyes
    id: 'orange-tabby', name: 'Mango', species: 'cat', photo: new URL('../../../../../assets/orangeTabby.png', import.meta.url).href,
    traits: {
      bodyLength: 0.78, girth: 0.22, legLength: 0.24, headSize: 0.27, snout: 0.05, earShape: 1, earSize: 0.85, tailLength: 0.5, tailUp: 0.55, size: 0.85,
      saddle: '#BC6C26',
      colors: { base: '#D98A3A', belly: '#EBB777', ear: '#C97A30', muzzle: '#F3D9B0', paws: '#F1D2A6', tailTip: '#F6E6CF', nose: '#D98880', eye: '#8FA05A' },
    },
  },
  {
    // grey longhair: smoky blue-grey all over, fluffy build and bushy tail, pale green eyes
    id: 'grey-longhair', name: 'Smokey', species: 'cat', photo: new URL('../../../../../assets/greyLonghair.png', import.meta.url).href,
    traits: {
      bodyLength: 0.8, girth: 0.27, legLength: 0.22, headSize: 0.28, snout: 0.05, earShape: 1, earSize: 0.8, tailLength: 0.46, tailUp: 0.6, tailFluff: 1.5, size: 0.9,
      colors: { base: '#6B6A70', belly: '#8C8A8E', ear: '#55545A', muzzle: '#77757A', paws: '#7E7C82', tailTip: '#5A595F', nose: '#3A3438', eye: '#9DB86A' },
    },
  },
  {
    // ragdoll: white chest, muzzle and feet, beige back, brown mask, dark brown ears and tail, pink nose, blue eyes
    id: 'ragdoll', name: 'Mochi', species: 'cat', photo: new URL('../../../../../assets/ragdoll.png', import.meta.url).href,
    traits: {
      bodyLength: 0.8, girth: 0.26, legLength: 0.23, headSize: 0.28, snout: 0.05, earShape: 1, earSize: 0.8, tailLength: 0.46, tailUp: 0.55, tailFluff: 1.4, size: 0.9,
      head: '#8A6650', saddle: '#DCC6B0',
      colors: { base: '#F4EDE2', belly: '#FFFFFF', ear: '#4A342B', muzzle: '#FFFFFF', paws: '#FFFFFF', tailTip: '#7A5A48', nose: '#E8A0A0', eye: '#4F86D8' },
    },
  },
  {
    // black shorthair: solid black, slim, big pale yellow-green eyes
    id: 'black-cat', name: 'Luna', species: 'cat', photo: new URL('../../../../../assets/blackCat.png', import.meta.url).href,
    traits: {
      bodyLength: 0.76, girth: 0.21, legLength: 0.25, headSize: 0.27, snout: 0.05, earShape: 1, earSize: 0.9, tailLength: 0.48, tailUp: 0.6, size: 0.85,
      colors: { base: '#262326', belly: '#2E2A2D', ear: '#1C1A1C', muzzle: '#2A2729', paws: '#262326', tailTip: '#262326', nose: '#151314', eye: '#C9D98A' },
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
    id: `known-${k.id}`, name, species: k.species, splatUrl: '', rigUrl: '', weightsUrl: '', thumbnailUrl: k.photo,
    plush: k.traits as unknown as Record<string, unknown>,
    personality: { eager: 0.8, sassy: 0.5, anxious: 0.2, chatty: 0.5 }, stats: { energy: 100, happiness: 80, hunger: 0 }, createdAt: new Date().toISOString(),
  };
}

