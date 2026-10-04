// What the pets say in the Play room and camera view: short, in character. Dogs are eager and warm, cats are dry.
// Kept to a small fixed set so every line is fetched from ElevenLabs once and then replayed from memory.
import type { PetBundle } from '@fetch/contracts';
import { speak } from './tts';

type Tone = 'dog' | 'cat';
export const LINES = {
  sit: { dog: ['Sitting!', 'Okay, okay, sitting.'], cat: ['Fine. Sitting.', 'I was going to sit anyway.'] },
  come: { dog: ['On my way!', 'Coming!'], cat: ['If I must.', 'Coming. Slowly.'] },
  follow: { dog: ['Right behind you!', 'Lead the way!'], cat: ['I will follow. For now.'] },
  lie: { dog: ['Down I go.', 'Ahh, comfy.'], cat: ['Nap time. Finally.'] },
  jump: { dog: ['Wheee!', 'Up!'], cat: ['Hup.', 'Watch closely.'] },
  go: { dog: ['Over here?', 'This way!'], cat: ['Here? Really?', 'Moving.'] },
  turn: { dog: ['Look at me spin!'], cat: ['One spin. That is all.'] },
  love: { dog: ['I love you too!', 'You are my favourite!'], cat: ['I tolerate you. Fondly.', 'I love you too. Do not tell anyone.'] },
  good: { dog: ['Best day ever!', 'Thank you!'], cat: ['Obviously.', 'I know.'] },
  paw: { dog: ['Nice to meet you!', 'Shake!'], cat: ['Gently, please.'] },
  look: { dog: ['I am looking!'], cat: ['I see you.'] },
  dance: { dog: ['Watch this!', 'Dance party!'], cat: ['Behold.', 'Do not film this.'] },
  dead: { dog: ['Bleh. I am dead.'], cat: ['So dramatic. Fine. Dead.'] },
  roll: { dog: ['Rolling!'], cat: ['Rolling. Happy?'] },
  surprise: { dog: ['Ta-da!'], cat: ['Ta-da. Or whatever.'] },
  unknown: { dog: ['Aww, thanks!', 'I like your voice!'], cat: ['Mm. Interesting.', 'I heard you. I am choosing a response.'] },
  fetched: { dog: ['Got it!', 'Again, again!'], cat: ['Here. You dropped this.', 'I am not a dog, you know.'] },
  fed: { dog: ['Yum!', 'So tasty!'], cat: ['Acceptable.', 'More, please.'] },
  stroked: { dog: ['Mmm, nice.', 'Right there!'], cat: ['Yes. There.', 'You may continue.'] },
  trick: { dog: ['Easy!', 'Did you see that?'], cat: ['Too easy.'] },
  greeting: { dog: ['Hi! Want to play?'], cat: ['Oh. You are here.'] },
} satisfies Record<string, Record<Tone, string[]>>;
export type LineId = keyof typeof LINES;

/** Which line goes with a voice command ("say hi" barks instead; "stand up" is silent). */
export const SPOKEN: Partial<Record<string, LineId>> = {
  sit: 'sit', come: 'come', follow: 'follow', lie: 'lie', jump: 'jump', left: 'go', right: 'go', up: 'go', down: 'go', turn: 'turn', love: 'love',
  good: 'good', paw: 'paw', look: 'look', dance: 'dance', dead: 'dead', roll: 'roll', surprise: 'surprise',
};

const last = new Map<string, number>();
/** A line for this moment, not the same one twice in a row when there is a choice. */
export function line(id: LineId, species: string) {
  const set = LINES[id][species === 'cat' ? 'cat' : 'dog'];
  let i = Math.floor(Math.random() * set.length);
  if (set.length > 1 && i === last.get(id)) i = (i + 1) % set.length;
  last.set(id, i);
  return set[i];
}

/** The pet says a line in its own voice, with lip-sync through `amplitude`. A failure (no key, no credits) is reported once. */
export function sayLine(id: LineId, pet: PetBundle, amplitude: (a: number) => void, onError?: (err: unknown) => void) {
  speak(line(id, pet.species), { species: pet.species, voiceId: pet.voiceId, onAmplitude: amplitude }).catch(err => { if (!failed) { failed = true; onError?.(err); } console.warn('pet voice unavailable', err); });
}
let failed = false;
