// The Play camera's voice commands and the matcher that turns whatever was heard into the nearest one.
// Local only (no network, no key). Speech recognizers mishear short words constantly ("sit" -> "set", "sieve", "city"),
// so there are three layers, in order:
//  1. SOUNDS-LIKE LISTS: every command lists the words and phrases recognizers commonly produce for it (`keys` below).
//  2. AUTOCORRECT BY SPELLING AND SOUND: a word that is not in a list is still matched when it is spelled nearly the same
//     (edit distance) or sounds the same (same first letter and consonant skeleton: "sot"/"sit", "dawn"/"down"); two
//     words heard as one ("sedan" for "sit down") or one heard as two are handled by joining/splitting.
//  3. KEY WORDS IN A LONG SENTENCE: the whole utterance is searched; filler words count for little.
// `interpret` returns the best command above a low floor, or null when nothing relates at all.
// ponytail: English only, word-level; an LLM could resolve paraphrases ("make yourself comfy") and would slot in where
// `interpret` returns null.

export type CommandId = 'sit' | 'come' | 'follow' | 'lie' | 'jump' | 'left' | 'right' | 'up' | 'down' | 'turn' | 'love' | 'good'
  | 'paw' | 'hi' | 'look' | 'dance' | 'dead' | 'roll' | 'surprise' | 'stand';

/** `keys`: the phrase itself, then everything a recognizer tends to turn it into (lower case, no punctuation). */
export const COMMANDS: { id: CommandId; label: string; keys: string[] }[] = [
  { id: 'sit', label: 'Sit', keys: ['sit down', 'sit', 'sits', 'sitting', 'set', 'sat', 'seat', 'seats', 'sip', 'sin', 'sid', 'sieve', 'city', 'sick', 'sight', 'cit', 'zit', 'sedan', 'set down', 'sat down', 'seat down', 'city down', 'sick down', 'so down', 'sit now', 'sit tight', 'sit still', 'sit please', 'take a seat'] },
  { id: 'come', label: 'Come here', keys: ['come here', 'come', 'comes', 'coming', 'calm', 'comb', 'kum', 'com', 'cam', 'came', 'cum', 'come on', 'come over', 'come over here', 'come back', 'come to me', 'come hear', 'come her', 'calm here', 'common', 'cmon', 'here', 'hear', 'hair', 'over here', 'get over here', 'this way'] },
  { id: 'follow', label: 'Follow me', keys: ['follow me', 'follow', 'follows', 'following', 'followed', 'fellow', 'fellow me', 'hollow', 'hollow me', 'swallow', 'fallow', 'fella', 'fall of me', 'follow us', 'stay with me', 'walk with me', 'walk with us'] },
  { id: 'lie', label: 'Lie down', keys: ['lie down', 'lay down', 'lie', 'lies', 'lay', 'lays', 'lye', 'lying', 'laying', 'lying down', 'laying down', 'laid down', 'lied down', 'like down', 'light down', 'line down', 'lie dawn', 'lie town', 'lie now', 'lion', 'liedown', 'layed down', 'get down', 'lie flat', 'rest'] },
  { id: 'jump', label: 'Jump', keys: ['jump', 'jumps', 'jumped', 'jumping', 'jumpy', 'jumper', 'jam', 'jab', 'jug', 'chump', 'trump', 'dump', 'gump', 'jum', 'jump up', 'jump high', 'hop', 'hops', 'hopping', 'leap', 'bounce', 'bunny hop'] },
  { id: 'left', label: 'Go left', keys: ['go left', 'left', 'lef', 'lift', 'loft', 'laughed', 'lest', 'let', 'leaf', 'go lift', 'go loft', 'go let', 'move left', 'walk left', 'turn left', 'step left', 'to the left', 'left side', 'on the left', 'that way'] },
  { id: 'right', label: 'Go right', keys: ['go right', 'right', 'write', 'rite', 'wright', 'ride', 'riot', 'bright', 'night', 'go write', 'go rite', 'go ride', 'go bright', 'move right', 'walk right', 'turn right', 'step right', 'to the right', 'right side', 'on the right', 'all right'] },
  { id: 'up', label: 'Go up', keys: ['go up', 'up', 'app', 'op', 'ap', 'cup', 'go app', 'go op', 'go cup', 'move up', 'go forward', 'forward', 'forwards', 'ahead', 'go ahead', 'go away', 'away', 'go back', 'farther', 'further', 'go far', 'go there'] },
  { id: 'down', label: 'Go down', keys: ['go down', 'down', 'dawn', 'done', 'don', 'dun', 'town', 'tone', 'dan', 'gown', 'go dawn', 'go done', 'go town', 'go dun', 'move down', 'closer', 'come closer', 'nearer', 'go near', 'back up', 'step back'] },
  { id: 'turn', label: 'Turn around', keys: ['turn around', 'turn', 'turns', 'turned', 'turning', 'tern', 'torn', 'burn', 'earn', 'learn', 'twist', 'twirl', 'twirls', 'spin', 'spins', 'spun', 'spinning', 'span', 'spend', 'spent', 'spine', 'turn round', 'turn a round', 'turn around dog', 'turned around', 'around', 'round', 'circle', 'circles', 'rotate', 'three sixty', 'do a spin', 'spin around'] },
  { id: 'love', label: 'I love you', keys: ['i love you', 'love you', 'love', 'loves', 'loved', 'loving', 'lover', 'luv', 'live', 'dove', 'glove', 'above', 'a love you', 'aye love you', 'i loved you', 'i live you', 'i love u', 'love you too', 'love u', 'i luv you', 'you are the best', 'miss you', 'hug', 'kiss', 'cuddle', 'cute'] },
  { id: 'good', label: 'Good dog', keys: ['good dog', 'good', 'goods', 'gud', 'could', 'would', 'wood', 'hood', 'dog', 'dogs', 'doggy', 'doggie', 'dawg', 'doc', 'dug', 'dock', 'doug', 'good boy', 'good girl', 'good puppy', 'good pup', 'good job', 'good doggy', 'good dawg', 'could dog', 'would dog', 'who is a good boy', 'who is a good dog', 'who is a good girl', 'well done', 'great job', 'nice job', 'atta boy', 'attaboy', 'boy', 'girl', 'puppy', 'pup', 'best dog'] },
  { id: 'paw', label: 'Give me your paw', keys: ['give me your paw', 'paw', 'paws', 'pa', 'pow', 'pour', 'poor', 'pause', 'pore', 'pall', 'your paw', 'give paw', 'give me paw', 'give me a paw', 'give me your pa', 'give me your pour', 'gimme paw', 'shake', 'shakes', 'shaking', 'shake hands', 'shake a paw', 'shake paw', 'high five', 'hi five', 'give me five', 'hand', 'your hand', 'give me your hand'] },
  { id: 'hi', label: 'Say hi', keys: ['say hi', 'hi', 'high', 'hey', 'hay', 'hello', 'hallo', 'hullo', 'yellow', 'hi there', 'hi dog', 'hey there', 'hey dog', 'say high', 'say hello', 'say hey', 'say i', 'sigh hi', 'say hi to me', 'wave', 'waves', 'waving', 'wave hi', 'wave hello', 'speak', 'bark', 'barks', 'woof', 'say woof', 'say bark', 'park', 'talk', 'howdy'] },
  { id: 'look', label: 'Look at me', keys: ['look at me', 'look', 'looks', 'looking', 'luck', 'lock', 'lake', 'lick', 'book', 'took', 'cook', 'look at it', 'look at', 'look at him', 'look here', 'look me', 'hey look', 'watch me', 'watch', 'eyes on me', 'eyes up here', 'pay attention', 'attention', 'face me', 'see me', 'over here look', 'look over here'] },
  { id: 'dance', label: 'Dance', keys: ['dance', 'dances', 'danced', 'dancing', 'dancer', 'dense', 'dans', 'dunce', 'chance', 'glance', 'stance', 'prance', 'pants', 'dance dance', 'do a dance', 'boogie', 'groove', 'disco', 'party', 'wiggle', 'shake it', 'break dance'] },
  { id: 'dead', label: 'Play dead', keys: ['play dead', 'dead', 'dad', 'did', 'dread', 'debt', 'deaf', 'death', 'die', 'dies', 'dye', 'dyed', 'play dad', 'play bed', 'play debt', 'plate dead', 'play date', 'played dead', 'playing dead', 'pretend dead', 'pretend to be dead', 'bang', 'bang bang', 'you are dead', 'fall over', 'faint', 'drop dead', 'fall down'] },
  { id: 'roll', label: 'Roll over', keys: ['roll over', 'roll', 'rolls', 'rolled', 'rolling', 'role', 'rule', 'rowel', 'real', 'roll of her', 'role over', 'rolled over', 'rolling over', 'rollover', 'roll a bear', 'all over', 'roll on', 'roll around', 'flip', 'flip over', 'barrel roll', 'tumble', 'turn over', 'rotate over', 'do a roll'] },
  { id: 'surprise', label: 'Surprise me', keys: ['surprise me', 'surprise', 'surprises', 'surprised', 'surprised me', 'suppress', 'supplies', 'supplies me', 'surprise us', 'trick', 'tricks', 'do a trick', 'do trick', 'do tricks', 'another trick', 'something funny', 'do something funny', 'do something', 'do something cool', 'go crazy', 'act like a puppy', 'random', 'anything', 'show me something', 'be silly', 'silly', 'funny', 'fun'] },
  { id: 'stand', label: 'Stand up', keys: ['stand up', 'stand', 'stands', 'standing', 'stan', 'sand', 'stood', 'stand on', 'get up', 'getup', 'got up', 'wake up', 'wake', 'woke up', 'rise', 'stop', 'stay', 'wait', 'freeze', 'enough', 'that is enough', 'relax', 'okay', 'ok'] },
];

// Words that carry little meaning on their own; they count for a quarter in a phrase, so "go" or "me" alone matches nothing.
const WEAK = new Set(['go', 'me', 'you', 'your', 'my', 'a', 'the', 'at', 'to', 'i', 'do', 'over', 'is', 'who', 'on', 'around', 'say', 'give', 'move', 'walk', 'play', 'something', 'it', 'us', 'with', 'of', 'be', 'all', 'step', 'her', 'him', 'u', 'aye']);
// Words that are only politeness or grammar: they do not count when judging how much of a short utterance a phrase explains.
const FILLER = new Set([...WEAK, 'please', 'can', 'could', 'would', 'will', 'just', 'now', 'then', 'for', 'and', 'so', 'hey', 'dog', 'are', 'this', 'that', 'what', 'want', 'let', 'lets', 'okay']);
const FLOOR = 0.6;          // below this nothing relates: the dog just wags (camera view fallback)
export const SURE = 0.8;    // at or above this a transcript is acted on without waiting for a second opinion

const GROUP: Record<string, string> = { b: 'p', p: 'p', d: 't', t: 't', c: 'k', k: 'k', q: 'k', g: 'k', s: 's', z: 's', x: 's', f: 'f', v: 'f', m: 'n', n: 'n', l: 'l', r: 'r', j: 'j' };
/** Consonant skeleton: "sit", "sot", "set", "seat" -> "st"; "down", "dawn" -> "tn". */
const consonants = (w: string) => [...w].filter(ch => GROUP[ch]).length;
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
  const sk = skeleton(a), sound = a[0] === b[0] && consonants(a) >= 2 && consonants(b) >= 2 && sk === skeleton(b) && Math.abs(a.length - b.length) <= 2;
  const e = lev(a, b), n = Math.max(a.length, b.length);
  const s = Math.max(1 - e / n, sound && e <= (n <= 4 ? 1 : 2) ? 0.85 : 0); // a sound-alike is one letter off in a short word, two in a longer one ("time" is not "tone")
  return s >= (n <= 4 ? 0.75 : 0.6) ? s : 0; // short words need to be nearly identical ("how" is not "hop")
}

export interface Match { id: CommandId; label: string; score: number; /** The phrase from the list it was matched to. */ phrase: string }

const tokens = (text: string) => text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/'s\b/g, ' is').replace(/'/g, '').split(/\s+/).filter(Boolean);

/** The command closest to what was said, or null if nothing in it relates to any command. */
export function interpret(text: string): Match | null {
  const said = tokens(text);
  if (!said.length) return null;
  // words glued together by the recognizer ("sit" + "dawn" heard as "sedan") are tried joined, too
  const joined: string[] = [];
  for (let i = 0; i + 1 < said.length; i++) { joined.push(said[i] + said[i + 1]); if (i + 2 < said.length) joined.push(said[i] + said[i + 1] + said[i + 2]); }
  const content = said.filter(w => !FILLER.has(w)), short = content.length > 0 && content.length <= 3;
  let best: (Match & { rank: number; strong: number; at: number }) | null = null;
  for (const c of COMMANDS) for (const key of c.keys) {
    const words = key.split(' ');
    let sum = 0, total = 0, at = said.length, strong = 0, prev = -2, adjacent = words.length > 1;
    const hit = new Set<number>();
    for (const w of words) {
      const weight = WEAK.has(w) ? 0.25 : 1, sims = said.map(s => alike(w, s)), top = Math.max(...sims), pos = sims.indexOf(top);
      sum += weight * top;
      total += weight;
      if (weight === 1) { strong++; if (top > 0) at = Math.min(at, pos); }
      if (top > 0) hit.add(pos);
      if (top === 0 || (prev >= 0 && pos !== prev + 1)) adjacent = false; // the phrase's words were said one after another
      prev = top > 0 ? pos : -2;
    }
    let score = sum / total;
    if (words.length > 1) { // "sedan" for "sit down": the whole phrase against one heard word, or against several glued together
      const whole = key.replace(/ /g, '');
      const g = Math.max(...said.map(s => alike(whole, s)), ...joined.map(s => alike(whole, s)));
      if (g > score) { score = g; at = 0; }
    }
    // a short utterance should be explained by the phrase: "sot dawn" is "sit down", not just "down"
    if (short) { const covered = content.filter(w => words.some(k => alike(k, w) > 0) || joined.length > 0 && alike(key.replace(/ /g, ''), w) > 0).length; score *= 0.55 + 0.45 * (covered / content.length); }
    const rank = score + (adjacent && score >= FLOOR ? 0.03 * words.length : 0); // said in order, side by side: "roll over" beats a stray "right"
    // equal rank: the phrase with more content words wins ("get up" is stand, not up), then the one said first
    const tie = best && Math.abs(rank - best.rank) < 1e-9;
    if (score >= FLOOR && (!best || rank > best.rank + 1e-9 || (tie && (strong > best!.strong || (strong === best!.strong && at < best!.at))))) best = { id: c.id, label: c.label, phrase: key, score: Math.min(1, score), rank, strong, at };
  }
  return best && { id: best.id, label: best.label, score: best.score, phrase: best.phrase };
}

/** Several guesses at the same speech (the browser offers up to five): the one that is the clearest command wins. */
export function interpretBest(guesses: string[]): { text: string; match: Match | null } {
  let best: { text: string; match: Match | null } = { text: guesses[0] ?? '', match: null };
  for (const g of guesses) { const m = interpret(g); if (m && (!best.match || m.score > best.match.score)) best = { text: g, match: m }; }
  return best;
}

/** What each phrase must resolve to (null = nothing relates). Run by the camera acceptance page. */
export const SELF_CHECK: [string, CommandId | null][] = [
  ['sit', 'sit'], ['Sit.', 'sit'], ['sot dawn', 'sit'], ['sit down', 'sit'], ['Sieve.', 'sit'], ['set', 'sit'], ['sedan', 'sit'], ['could you please sit down for me', 'sit'],
  ['come here', 'come'], ['come over here boy', 'come'], ['come back', 'come'], ['calm', 'come'], ['follow me', 'follow'], ['fellow me', 'follow'],
  ['lie down', 'lie'], ['lay down', 'lie'], ['like down', 'lie'],
  ['jump', 'jump'], ['jump up', 'jump'], ['chump', 'jump'], ['go left', 'left'], ['move to the left', 'left'], ['go lift', 'left'], ['go right', 'right'], ['go write', 'right'],
  ['go up', 'up'], ['go down', 'down'], ['go dawn', 'down'], ['turn around', 'turn'], ['spin', 'turn'], ['span', 'turn'], ['I love you', 'love'], ['a love you', 'love'],
  ['good dog!', 'good'], ['could dog', 'good'], ["who's a good boy", 'good'],
  ['give me your paw', 'paw'], ['give me your pour', 'paw'], ['shake', 'paw'], ['say hi', 'hi'], ['say high', 'hi'], ['hello there', 'hi'], ['look at me', 'look'], ['luck at me', 'look'],
  ['dance', 'dance'], ['dense', 'dance'], ['can you dance for me', 'dance'],
  ['play dead', 'dead'], ['play dad', 'dead'], ['roll over', 'roll'], ['role over', 'roll'], ['surprise me', 'surprise'], ['supplies me', 'surprise'], ['do a trick', 'surprise'],
  ['stand up', 'stand'], ['get up', 'stand'], ['stop', 'stand'],
  ['I want you to roll over on the floor right now', 'roll'], ['hey look at me', 'look'], ['what time is it', null], ['', null], ['the weather is nice', null],
];
