// What the pets do instead of talking: a cute call (dog: puppy yips, cat: a mew) with the head bobbing to it.
// Which moment gets how many calls; the sounds themselves are synthesized in play/sfx.ts.
import { petCall } from '../play/sfx';

export type LineId = 'sit' | 'come' | 'follow' | 'lie' | 'jump' | 'go' | 'turn' | 'love' | 'good' | 'paw' | 'look' | 'dance' | 'dead' | 'roll' | 'surprise'
  | 'unknown' | 'fetched' | 'fed' | 'stroked' | 'trick' | 'greeting';

/** How many yips (or mews) each moment gets: calm moments one, happy ones two or three. */
const COUNT: Record<LineId, number> = {
  sit: 1, come: 2, follow: 1, lie: 1, jump: 2, go: 1, turn: 1, love: 3, good: 3, paw: 1, look: 1, dance: 3, dead: 1, roll: 1, surprise: 2,
  unknown: 2, fetched: 2, fed: 1, stroked: 1, trick: 2, greeting: 3,
};

/** Which call goes with a voice command ("say hi" and "speak" call out on their own; "stand up" is silent). */
export const SPOKEN: Partial<Record<string, LineId>> = {
  sit: 'sit', come: 'come', follow: 'follow', lie: 'lie', jump: 'jump', left: 'go', right: 'go', up: 'go', down: 'go', turn: 'turn', love: 'love',
  good: 'good', paw: 'paw', look: 'look', dance: 'dance', dead: 'dead', roll: 'roll', surprise: 'surprise',
};

/** The pet calls out; `amplitude` is driven with the loudness so the head bobs with each yip. Resolves when it is over. */
export function callOut(pet: { species: string }, amplitude: (a: number) => void, count = 1, volume = 0.45): Promise<void> {
  const calls = petCall(pet.species, count, volume);
  if (!calls.length) return Promise.resolve();
  const t0 = performance.now(), end = Math.max(...calls.map(c => c.at + c.dur)) * 1000;
  return new Promise(done => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      let a = 0;
      for (const c of calls) if (t >= c.at && t <= c.at + c.dur) a = Math.max(a, Math.sin(((t - c.at) / c.dur) * Math.PI)); // a bump per call
      if (t * 1000 >= end) { amplitude(0); done(); return; }
      amplitude(a);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/** The reaction for a moment (a command, a fetch, a treat...). */
export function react(id: LineId, pet: { species: string }, amplitude: (a: number) => void) { void callOut(pet, amplitude, COUNT[id]); }
