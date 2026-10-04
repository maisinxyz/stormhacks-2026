// The pet's voice: ElevenLabs text-to-speech through the server (POST /voice/tts picks the voice: the pet's own voiceId,
// else the species default). Each line is fetched once and kept in memory, so repeats cost nothing and play at once.
// The loudness of what is playing is reported every frame, for the pet's lip-sync.
import type { Species } from '@fetch/contracts';

export interface SpeakOptions {
  species: Species; voiceId?: string;
  /** 0..1 */
  volume?: number;
  /** 0..1 loudness while speaking; 0 when it stops. */
  onAmplitude?(a: number): void;
  onDone?(): void;
}

let ctx: AudioContext | undefined;
const cache = new Map<string, Promise<AudioBuffer>>();
let current: { stop(): void } | undefined;

const audio = () => { ctx ??= new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); return ctx; };

function load(text: string, o: SpeakOptions) {
  const key = `${o.voiceId ?? o.species}|${text}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const r = await fetch('/voice/tts', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, species: o.species, ...(o.voiceId ? { voiceId: o.voiceId } : {}) }) });
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return audio().decodeAudioData(await r.arrayBuffer());
    })();
    p.catch(() => cache.delete(key)); // a failed line can be tried again
    cache.set(key, p);
  }
  return p;
}

/** Fetch lines ahead of time (e.g. the ones a pet is most likely to say next). Failures are silent. */
export function preload(lines: string[], o: SpeakOptions) { for (const l of lines) load(l, o).catch(() => {}); }

/** Stop whatever is being said. */
export function hush() { current?.stop(); }

/** Say `text` in the pet's voice. Replaces anything still playing. Rejects if the audio could not be fetched. */
export async function speak(text: string, o: SpeakOptions) {
  const mine = {}; turn = mine;
  const buf = await load(text, o);
  if (turn !== mine) return; // something newer was asked for while this was loading
  hush();
  const c = audio(), src = c.createBufferSource(), gain = c.createGain(), an = c.createAnalyser();
  an.fftSize = 512;
  gain.gain.value = Math.max(0, Math.min(1, o.volume ?? 1));
  src.buffer = buf; src.connect(gain).connect(an).connect(c.destination);
  const data = new Float32Array(an.fftSize);
  let raf = 0, done = false;
  const end = () => { if (done) return; done = true; cancelAnimationFrame(raf); if (current === me) current = undefined; o.onAmplitude?.(0); o.onDone?.(); };
  const tick = () => {
    an.getFloatTimeDomainData(data);
    let s = 0;
    for (let i = 0; i < data.length; i++) s += data[i] * data[i];
    o.onAmplitude?.(Math.min(1, Math.sqrt(s / data.length) * 5));
    raf = requestAnimationFrame(tick);
  };
  const me = { stop: () => { try { src.stop(); } catch { /* not started */ } end(); } };
  current = me;
  src.onended = end;
  src.start();
  if (o.onAmplitude) tick();
}
let turn: object | undefined;
