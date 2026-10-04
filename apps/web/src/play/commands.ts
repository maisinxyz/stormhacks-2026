// The Play camera's voice commands and the matcher that turns whatever was heard into the nearest one.
// Local only (no network, no key): every word of the utterance is compared with each command's phrases by spelling
// (edit distance) and by sound (consonant skeleton), so "sot dawn" -> "sit down" and a long sentence is searched for
// its key words. `interpret` returns the best command above a low floor, or null when nothing relates at all.
// ponytail: English only, word-level; an LLM could resolve paraphrases ("make yourself comfy") and would slot in
// where `interpret` returns null.

export type CommandId = 'sit' | 'come' | 'follow' | 'lie' | 'jump' | 'left' | 'right' | 'up' | 'down' | 'turn' | 'love' | 'good'
  | 'paw' | 'hi' | 'look' | 'dance' | 'dead' | 'roll' | 'surprise' | 'stand';

/** `keys`: phrases that mean this command, including what speech recognizers commonly turn them into. */
export const COMMANDS: { id: CommandId; label: string; keys: string[] }[] = [
  { id: 'sit', label: 'Sit', keys: ['sit down', 'sit', 'sieve', 'city', 'seat', 'sitting'] },
  { id: 'come', label: 'Come here', keys: ['come here', 'come over here', 'come back', 'come', 'here', 'calm here', 'come to me', 'come on'] },
  { id: 'follow', label: 'Follow me', keys: ['follow me', 'follow', 'following'] },
  { id: 'lie', label: 'Lie down', keys: ['lie down', 'lay down', 'lie', 'lay', 'lying down', 'like down'] },
  { id: 'jump', label: 'Jump', keys: ['jump', 'jump up', 'hop'] },
  { id: 'left', label: 'Go left', keys: ['go left', 'left', 'move left', 'walk left', 'to the left'] },
  { id: 'right', label: 'Go right', keys: ['go right', 'right', 'move right', 'walk right', 'to the right', 'go write', 'go rite'] },
  { id: 'up', label: 'Go up', keys: ['go up', 'go forward', 'forward', 'go away', 'go back', 'move up', 'farther', 'further'] },
  { id: 'down', label: 'Go down', keys: ['go down', 'move down', 'come closer', 'closer', 'nearer'] },
  { id: 'turn', label: 'Turn around', keys: ['turn around', 'turn', 'spin', 'spin around', 'twirl'] },
  { id: 'love', label: 'I love you', keys: ['i love you', 'love you', 'love'] },
  { id: 'good', label: 'Good dog', keys: ['good dog', 'good boy', 'good girl', 'good puppy', 'good job', 'who is a good boy', 'well done'] },
  { id: 'paw', label: 'Give me your paw', keys: ['give me your paw', 'paw', 'shake hands', 'shake', 'high five', 'your hand'] },
  { id: 'hi', label: 'Say hi', keys: ['say hi', 'say high', 'say hello', 'hello', 'hi', 'hey', 'wave'] },
  { id: 'look', label: 'Look at me', keys: ['look at me', 'look here', 'look', 'eyes on me', 'watch me'] },
  { id: 'dance', label: 'Dance', keys: ['dance', 'dancing', 'boogie'] },
  { id: 'dead', label: 'Play dead', keys: ['play dead', 'dead', 'bang', 'die'] },
  { id: 'roll', label: 'Roll over', keys: ['roll over', 'roll', 'rollover', 'rolling'] },
  { id: 'surprise', label: 'Surprise me', keys: ['surprise me', 'surprise', 'do a trick', 'trick', 'something funny', 'do something'] },
  { id: 'stand', label: 'Stand up', keys: ['stand up', 'stand', 'get up', 'stop'] }, // not on the headline list: it ends a held Sit / Lie down
];

// Words that carry little meaning on their own; they count for a quarter in a phrase, so "go" or "me" alone matches nothing.
const WEAK = new Set(['go', 'me', 'you', 'your', 'my', 'a', 'the', 'at', 'to', 'i', 'do', 'over', 'is', 'who', 'on', 'around', 'say', 'give', 'move', 'walk', 'play', 'something']);
const FLOOR = 0.6;          // below this nothing relates: the dog just wags (camera view fallback)
export const SURE = 0.8;    // at or above this a transcript is acted on without waiting for a second opinion

const GROUP: Record<string, string> = { b: 'p', p: 'p', d: 't', t: 't', c: 'k', k: 'k', q: 'k', g: 'k', s: 's', z: 's', x: 's', f: 'f', v: 'f', m: 'n', n: 'n', l: 'l', r: 'r', j: 'j' };
/** Consonant skeleton: "sit", "sot", "set", "seat" -> "st"; "down", "dawn" -> "tn". */
function skeleton(w: string) {
  let out = GROUP[w[0]] ?? 'a';
  for (let i = 1; i < w.length; i++) { const g = GROUP[w[i]]; if (g && out[out.length - 1] !== g) out += g; }
  return out;
}
function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
/** 0..1: how alike two words are (1 = same word). Words of one or two letters must match exactly. */
function alike(a: string, b: string) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) <= 2) return 0;
  // sound-alike: same first letter and the same consonant skeleton ("sot"/"sit", "dawn"/"down"), but not "time"/"down" or "the"/"die"
  const sk = skeleton(a), sound = a[0] === b[0] && sk.length >= 2 && sk === skeleton(b) && Math.abs(a.length - b.length) <= 2;
  const s = Math.max(1 - lev(a, b) / Math.max(a.length, b.length), sound ? 0.85 : 0);
  return s >= 0.6 ? s : 0;
}

export interface Match { id: CommandId; label: string; score: number }

/** The command closest to what was said, or null if nothing in it relates to any command. */
export function interpret(text: string): Match | null {
  const said = text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/'s\b/g, ' is').replace(/'/g, '').split(/\s+/).filter(Boolean);
  if (!said.length) return null;
  let best: (Match & { words: number; at: number }) | null = null;
  for (const c of COMMANDS) for (const key of c.keys) {
    const words = key.split(' ');
    let sum = 0, total = 0, at = said.length;
    for (const w of words) {
      const weight = WEAK.has(w) ? 0.25 : 1, sims = said.map(s => alike(w, s)), top = Math.max(...sims);
      sum += weight * top;
      total += weight;
      if (weight === 1 && top > 0) at = Math.min(at, sims.indexOf(top)); // where its key word was said
    }
    const score = sum / total;
    // equal scores: the command whose key word was said first wins ("roll over ... right now" is a roll), then the more specific phrase
    const tie = best && Math.abs(score - best.score) < 1e-9;
    if (score >= FLOOR && (!best || score > best.score + 1e-9 || (tie && (at < best!.at || (at === best!.at && words.length > best!.words))))) best = { id: c.id, label: c.label, score, words: words.length, at };
  }
  return best && { id: best.id, label: best.label, score: best.score };
}

/** What each phrase must resolve to (null = nothing relates). Run by the camera acceptance page. */
export const SELF_CHECK: [string, CommandId | null][] = [
  ['sit', 'sit'], ['Sit.', 'sit'], ['sot dawn', 'sit'], ['sit down', 'sit'], ['Sieve.', 'sit'], ['could you please sit down for me', 'sit'],
  ['come here', 'come'], ['come over here boy', 'come'], ['come back', 'come'], ['follow me', 'follow'], ['lie down', 'lie'], ['lay down', 'lie'],
  ['jump', 'jump'], ['jump up', 'jump'], ['go left', 'left'], ['move to the left', 'left'], ['go right', 'right'], ['go write', 'right'],
  ['go up', 'up'], ['go down', 'down'], ['turn around', 'turn'], ['spin', 'turn'], ['I love you', 'love'], ['good dog!', 'good'], ["who's a good boy", 'good'],
  ['give me your paw', 'paw'], ['say hi', 'hi'], ['hello there', 'hi'], ['look at me', 'look'], ['dance', 'dance'], ['can you dance for me', 'dance'],
  ['play dead', 'dead'], ['roll over', 'roll'], ['role over', 'roll'], ['surprise me', 'surprise'], ['do a trick', 'surprise'], ['stand up', 'stand'], ['get up', 'stand'],
  ['I want you to roll over on the floor right now', 'roll'], ['what time is it', null], ['', null], ['the weather is nice', null],
];
