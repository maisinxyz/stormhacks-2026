// Speech-to-text: the microphone streamed live to ElevenLabs Scribe v2 Realtime.
// The browser never sees the API key: the server mints a single-use token (GET /voice/stt-token) for each turn.
// Measured on 80 synthetic clips (4 voices, two accented): the right command 79 times with the command words passed as
// keyterms, 73 without, text back about 160 ms after the audio ends. (The on-device Whisper it replaced: 59 of 80.)
// There is no fallback recognizer: no key, no credits or no internet means onError('unavailable').

const WS = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const RATE = 16000, CHUNK = 1600;     // 100 ms of 16 kHz audio per message
const FINAL_WAIT_MS = 2500;           // after a manual stop: how long to wait for the final text before using the last partial
const SESSION_MS = 15000;             // no turn is longer than this (a silent room never commits by itself)

export interface ScribeHandlers {
  /** Words so far (changes as the user keeps talking). */
  onPartial?(text: string): void;
  /** The finished phrase. '' = nothing intelligible was said. */
  onFinal(text: string): void;
  /** 'not-allowed' | 'audio-capture' (microphone), 'unavailable' (no token: key, credits or server), 'network'. */
  onError(code: string): void;
}

// the capture worklet only forwards raw samples; resampling and packing happen on the main thread
const WORKLET = URL.createObjectURL(new Blob([
  'class Tap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("fetch-mic-tap",Tap)',
], { type: 'application/javascript' }));

let spare: Promise<string> | undefined;
const mint = async () => {
  const r = await fetch('/voice/stt-token', { credentials: 'include' });
  if (!r.ok) throw new Error(`stt-token ${r.status}`);
  return ((await r.json()) as { token: string }).token;
};
/** Fetch a token ahead of the next turn so the mic opens without a round trip. Safe to call often. */
export function warmScribe() { spare ??= mint(); spare.catch(() => { spare = undefined; }); }
const takeToken = () => { const t = spare ?? mint(); spare = undefined; return t; };

export const scribeSupported = () => typeof WebSocket !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export class ScribeListener {
  private stream?: MediaStream;
  private ctx?: AudioContext; private node?: AudioWorkletNode; private src?: MediaStreamAudioSourceNode;
  private ws?: WebSocket;
  private queue: string[] = [];      // audio captured before the socket opened (so the first word is not lost)
  private pending: number[] = [];
  private turn = 0; private partial = ''; private finalTimer = 0;
  /** 0..1 loudness of the microphone right now. */
  level = 0;

  /** keyterms: words and short phrases the recognizer should favour (at most 50, 20 characters each). */
  constructor(private keyterms: string[] = []) {}

  get active() { return !!this.ws; }

  async start(h: ScribeHandlers) {
    const turn = ++this.turn;
    this.partial = ''; this.queue = []; this.pending = []; this.wantStop = false;
    const token = takeToken();
    token.catch(() => { /* reported below */ });
    try {
      this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) { if (turn === this.turn) h.onError((err as DOMException).name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture'); return; }
    if (turn !== this.turn) return;
    try { await this.capture(); } catch (err) { console.warn('mic capture failed', err); if (turn === this.turn) h.onError('audio-capture'); return; }
    let t: string;
    try { t = await token; } catch (err) { console.warn('no speech token', err); if (turn === this.turn) { this.close(); h.onError('unavailable'); } return; }
    if (turn !== this.turn) return;
    const q = new URLSearchParams({ model_id: 'scribe_v2_realtime', audio_format: `pcm_${RATE}`, language_code: 'en', commit_strategy: 'vad', vad_silence_threshold_secs: '0.8', token: t });
    for (const k of this.keyterms.slice(0, 50)) if (k.length <= 20) q.append('keyterms', k);
    const ws = this.ws = new WebSocket(`${WS}?${q}`);
    let done = false;
    const finish = (text: string) => { if (done || turn !== this.turn) return; done = true; this.close(); h.onFinal(text.trim()); };
    this.finish = finish;
    ws.onopen = () => { for (const a of this.queue) ws.send(a); this.queue = []; if (this.wantStop) this.stop(); };
    this.sessionTimer = window.setTimeout(() => { if (turn === this.turn) this.stop(); }, SESSION_MS);
    ws.onmessage = ev => {
      let m: { message_type?: string; text?: string; error?: string };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.message_type === 'partial_transcript') { this.partial = m.text ?? ''; if (this.partial) h.onPartial?.(this.partial); }
      else if (m.message_type?.startsWith('committed_transcript')) { if ((m.text ?? '').trim() || this.stopping) finish(m.text ?? ''); } // an empty commit while still listening: keep going
      else if (m.message_type && m.message_type !== 'session_started') { // auth_error, quota_exceeded, rate_limited, ...
        console.warn('scribe:', m.message_type, m.error ?? '');
        if (!done && turn === this.turn) { done = true; this.close(); h.onError(/auth|quota|rate|resource/.test(m.message_type) ? 'unavailable' : 'network'); }
      }
    };
    ws.onerror = () => { if (!done && turn === this.turn) { done = true; this.close(); h.onError('network'); } };
    ws.onclose = () => { if (!done && turn === this.turn) finish(this.partial); };
    warmScribe(); // a token for the turn after this one
  }
  private finish?: (text: string) => void;
  private stopping = false; private wantStop = false; private sessionTimer = 0;

  /** The user is done talking: ask for the final text now (it arrives through onFinal). */
  stop() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.wantStop = true; return; } // still connecting: stop as soon as it opens
    if (this.stopping) return;
    this.stopping = true;
    this.flush(true);
    this.detach(); // stop sending audio, keep the socket for the answer
    this.finalTimer = window.setTimeout(() => this.finish?.(this.partial), FINAL_WAIT_MS);
  }
  /** Drop this turn without a result. */
  abort() { this.turn++; this.close(); }
  /** Close the microphone (the browser's recording light goes off). */
  release() { this.abort(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined; }

  private async capture() {
    const ctx = this.ctx = new AudioContext();
    await ctx.audioWorklet.addModule(WORKLET);
    this.src = ctx.createMediaStreamSource(this.stream!);
    this.node = new AudioWorkletNode(ctx, 'fetch-mic-tap', { numberOfOutputs: 0 });
    const step = ctx.sampleRate / RATE;
    let acc = 0, n = 0, frac = 0; // box filter down to 16 kHz: each output sample is the mean of the input samples it covers
    this.node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      const b = ev.data;
      let s = 0;
      for (let i = 0; i < b.length; i++) {
        s += b[i] * b[i];
        acc += b[i]; n++;
        if (++frac >= step) { this.pending.push(acc / n); acc = 0; n = 0; frac -= step; }
      }
      this.level = Math.min(1, Math.sqrt(s / b.length) * 12);
      if (this.pending.length >= CHUNK) this.flush(false);
    };
    this.src.connect(this.node);
  }
  private flush(commit: boolean) {
    const pcm = new Int16Array(this.pending.length);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, this.pending[i])) * 32767;
    this.pending = [];
    const bytes = new Uint8Array(pcm.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: btoa(bin), sample_rate: RATE, ...(commit ? { commit: true } : {}) });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(msg); else this.queue.push(msg);
  }
  private detach() {
    this.node?.port.close(); this.src?.disconnect(); void this.ctx?.close();
    this.node = undefined; this.src = undefined; this.ctx = undefined; this.level = 0;
  }
  private close() {
    window.clearTimeout(this.finalTimer); window.clearTimeout(this.sessionTimer);
    this.detach();
    const ws = this.ws;
    this.ws = undefined; this.stopping = false; this.finish = undefined;
    if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch { /* already closed */ } }
  }
}
