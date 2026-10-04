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
