// Synthesized pet calls for the Play room, camera view and Desk (no audio files): a puppy's "yip yip" for dogs and a
// little "mew" for cats. They are short and high on purpose: cute, not scary. They are only played after the microphone
// has closed, so they cannot be heard as a command.
let ctx: AudioContext | undefined;

/** One puppy yip: a quick rise and fall in pitch through a bright, nasal filter, plus a puff of breath. */
function yip(c: AudioContext, t: number, pitch: number, vol: number) {
  const f0 = 560 * pitch;
  const body = c.createOscillator(), air = c.createOscillator(), band = c.createBiquadFilter(), g = c.createGain(), airGain = c.createGain();
  body.type = 'triangle'; air.type = 'sine';
  for (const [o, k] of [[body, 1], [air, 2]] as const) {
    o.frequency.setValueAtTime(f0 * 0.78 * k, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.55 * k, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.05 * k, t + 0.14);
  }
  airGain.gain.value = 0.35;
  band.type = 'bandpass'; band.Q.value = 1.6;
  band.frequency.setValueAtTime(1300, t); band.frequency.exponentialRampToValueAtTime(2300, t + 0.05); band.frequency.exponentialRampToValueAtTime(1500, t + 0.14);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  body.connect(band); air.connect(airGain).connect(band); band.connect(g).connect(c.destination);
  body.start(t); air.start(t); body.stop(t + 0.18); air.stop(t + 0.18);
  breath(c, t, 0.07, vol * 0.18);
}

/** One small "mee-ow": the pitch glides up and back down, with a wobble, and the vowel filter opens and closes. */
function mew(c: AudioContext, t: number, pitch: number, vol: number) {
  const f0 = 640 * pitch, dur = 0.46;
  const o = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lfoDepth = c.createGain(), band = c.createBiquadFilter(), g = c.createGain();
  o.type = 'triangle'; o2.type = 'sine';
  for (const [x, k] of [[o, 1], [o2, 2]] as const) {
    x.frequency.setValueAtTime(f0 * 0.9 * k, t);
    x.frequency.exponentialRampToValueAtTime(f0 * 1.6 * k, t + 0.14);
    x.frequency.exponentialRampToValueAtTime(f0 * 1.05 * k, t + dur);
  }
  lfo.frequency.value = 7; lfoDepth.gain.value = 14;
  lfo.connect(lfoDepth); lfoDepth.connect(o.frequency); lfoDepth.connect(o2.frequency);
  const og = c.createGain(); og.gain.value = 0.3;
  band.type = 'bandpass'; band.Q.value = 3;
  band.frequency.setValueAtTime(900, t); band.frequency.exponentialRampToValueAtTime(2400, t + 0.15); band.frequency.exponentialRampToValueAtTime(1200, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(vol * 0.7, t + 0.26); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(band); o2.connect(og).connect(band); band.connect(g).connect(c.destination);
  for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.02); }
}

/** A short burst of high-passed noise: the breath at the start of a sound. */
function breath(c: AudioContext, t: number, secs: number, vol: number) {
  const n = c.createBufferSource(), buf = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const hp = c.createBiquadFilter(), g = c.createGain();
  hp.type = 'highpass'; hp.frequency.value = 2500; g.gain.value = vol;
  n.buffer = buf; n.connect(hp).connect(g).connect(c.destination); n.start(t);
}

export interface PetCall { /** seconds from now */ at: number; dur: number }
/** A cute call: `count` quick yips for a dog, or `count` mews for a cat. Returns when each one sounds. Silent (and empty) if
 *  audio is blocked. */
export function petCall(species: string, count = 1, volume = 0.45): PetCall[] {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + 0.02, out: PetCall[] = [];
    const pitches = [1, 1.14, 0.96, 1.2];
    for (let i = 0; i < count; i++) {
      const pitch = pitches[i % pitches.length], v = volume * (i === 0 ? 1 : 0.9);
      if (species === 'cat') { const at = i * 0.6; mew(ctx, start + at, pitch, v); out.push({ at: at + 0.02, dur: 0.46 }); }
      else { const at = i * 0.2; yip(ctx, start + at, pitch, v); out.push({ at: at + 0.02, dur: 0.16 }); }
    }
    return out;
  } catch { return []; /* no audio: the head bob still shows the call */ }
}

// ---- first-person room effects (same idea: synthesized, no files) ----
function audio() { ctx ??= new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); return ctx; }
/** A burst of filtered noise: the body of a whoosh or a crunch. */
function noise(c: AudioContext, t: number, secs: number, from: number, to: number, vol: number, q = 1.2) {
  const n = c.createBufferSource(), buf = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const band = c.createBiquadFilter(), g = c.createGain();
  band.type = 'bandpass'; band.Q.value = q;
  band.frequency.setValueAtTime(from, t); band.frequency.exponentialRampToValueAtTime(to, t + secs);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + secs * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  n.buffer = buf; n.connect(band).connect(g).connect(c.destination); n.start(t);
}
/** Throw: a rising whoosh (the frisbee is longer and airier). */
export function whoosh(frisbee = false, volume = 0.35) {
  try { const c = audio(); noise(c, c.currentTime + 0.01, frisbee ? 0.42 : 0.24, frisbee ? 500 : 700, frisbee ? 2600 : 1900, volume); } catch { /* no audio */ }
}
/** Ball hitting the floor or a wall; `speed` (m/s) sets how hard. */
export function thump(speed: number) {
  try {
    const c = audio(), t = c.currentTime + 0.005, o = c.createOscillator(), g = c.createGain(), vol = Math.min(0.5, 0.06 * speed);
    o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.13);
  } catch { /* no audio */ }
}
/** Eating: three quick crunches. */
export function crunch(volume = 0.3) {
  try { const c = audio(), t = c.currentTime + 0.02; for (let i = 0; i < 3; i++) noise(c, t + i * 0.16, 0.07, 2400 - i * 300, 900, volume, 0.8); } catch { /* no audio */ }
}
