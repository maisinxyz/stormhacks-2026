// A synthesized dog bark for the Play camera (no audio files). Two short "woofs": a falling sawtooth through a
// band-pass plus a puff of noise. It is only played after the microphone has closed, so it cannot be heard as a command.
let ctx: AudioContext | undefined;

function woof(c: AudioContext, t: number, pitch: number, vol: number) {
  const o = c.createOscillator(), band = c.createBiquadFilter(), g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(430 * pitch, t); o.frequency.exponentialRampToValueAtTime(160 * pitch, t + 0.14);
  band.type = 'bandpass'; band.Q.value = 1.1;
  band.frequency.setValueAtTime(950, t); band.frequency.exponentialRampToValueAtTime(420, t + 0.14);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  o.connect(band).connect(g).connect(c.destination);
  o.start(t); o.stop(t + 0.19);
  // breath: a short noise burst gives the bark its rough edge
  const n = c.createBufferSource(), buf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.12), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const ng = c.createGain(), hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 700;
  ng.gain.value = vol * 0.35;
  n.buffer = buf; n.connect(hp).connect(ng).connect(c.destination); n.start(t);
}

/** "Woof woof". Silently does nothing if audio is unavailable or blocked. */
export function bark(volume = 0.45) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.02;
    woof(ctx, t, 1, volume); woof(ctx, t + 0.21, 0.88, volume * 0.9);
  } catch { /* no audio: the bubble and the head jerk still show the bark */ }
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
