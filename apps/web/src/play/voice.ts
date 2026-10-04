// Push-to-talk voice for the Play shell (play.md B.7 / A.7). Web Speech API + the local-intent table from PRD.md 2.4.
// ponytail: browser speech recognition only (Chrome, Safari); swap in the F2 ElevenLabs Scribe path when the Play shell
// shares a build with apps/desk.
import type { LocalIntent } from '@fetch/contracts';
import { loadWhisper, rms, toPcm, transcribe } from './whisper';

export type VoiceCommand = { kind: 'intent'; intent: LocalIntent } | { kind: 'praise' } | { kind: 'feed' } | { kind: 'follow' } | { kind: 'swap' };

// Whisper (and every recognizer) mishears single short words, so each command lists the words it commonly turns into
// ("sit" -> "sieve", "set", "sat"). The mic only listens for commands, so the looser match is safe.
const TABLE: [RegExp, VoiceCommand][] = [
  [/\b(roll(ing)? over|role over|rollover)\b/, { kind: 'intent', intent: 'roll_over' }],
  [/\bplay(ing)? (dead|dad)\b/, { kind: 'intent', intent: 'play_dead' }],
  [/\b(fetch(es|ed)?|get the ball|ball)\b/, { kind: 'intent', intent: 'fetch_ball' }],
  [/\bgood (boy|girl|pet|dog|bird|puppy)\b/, { kind: 'praise' }],
  [/\b(treat|feed|dinner|food)\b/, { kind: 'feed' }],
  [/\b(other side|switch sides?|swap( sides?)?|move over)\b/, { kind: 'swap' }], // camera view: stand on the other side of the shot
  [/\bfollow\b/, { kind: 'follow' }], // camera view: keep in front of the user as they turn
  [/\b(wake( up)?|woke up|week up)\b/, { kind: 'intent', intent: 'wake' }],
  [/\b(sleep|asleep|nap|bed ?time)\b/, { kind: 'intent', intent: 'sleep' }],
  [/\b(sit(s|ting)?|sat|set|seat|sieve|sip|sin|sid)\b/, { kind: 'intent', intent: 'sit' }],
  [/\b(stay|stray|stage|state)\b/, { kind: 'intent', intent: 'stay' }],
  [/\b(come|calm|coming|c'?mon|common|here)\b/, { kind: 'intent', intent: 'come' }],
  [/\b(speak|bark(s)?|park)\b/, { kind: 'intent', intent: 'speak' }],
  [/\b(spin|span|spend|spent)\b/, { kind: 'intent', intent: 'spin' }],
  [/\b(shake|paw)\b/, { kind: 'intent', intent: 'shake' }],
  [/\b(dance|dense|stance)\b/, { kind: 'intent', intent: 'dance' }],
  [/\bhide\b/, { kind: 'intent', intent: 'hide' }],
  [/\btrick\b/, { kind: 'intent', intent: 'trick' }],
  [/\b(stop|stand|get up|up)\b/, { kind: 'intent', intent: 'stop' }], // 'stop' is the stand-in-place intent
];

export function parseCommand(text: string): VoiceCommand | null {
  const t = text.toLowerCase();
  return TABLE.find(([re]) => re.test(t))?.[1] ?? null;
}

interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}

const MIN_MS = 350;                 // a clip shorter than this is a stray tap, not a command
const MAX_MS = 8000;                // hard stop
const NO_SPEECH_MS = 6000;          // gives up if nothing is said
const END_SILENCE_MS = 1000;        // stops this long after the user finishes speaking
const TAIL_MS = 300;                // a manual stop keeps recording this much longer (people tap early)

export type VoiceState = 'idle' | 'listening' | 'interpreting';

/** Tap to start, tap again to stop (it also stops by itself when you finish speaking). Two recognizers run side by side:
 *  the browser's own (fast, needs Google/Apple's service) and Whisper on the device (works anywhere). A phrase that
 *  parses as a command wins immediately, otherwise the Whisper text is used. Each turn yields at most one result. */
export class PushToTalk {
  private rec?: Recognition;
  private heard = '';
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private turn = 0;
  private done = false;
  private browserText = '';
  private browserFailed = '';
  private state: VoiceState = 'idle';
  private level?: { ctx: AudioContext; an: AnalyserNode; buf: Float32Array<ArrayBuffer>; timer: number };
  /** 0..1 loudness while listening (drives the button's pulse). */
  micLevel = 0;
  readonly supported: boolean;

  /** onText: what was heard. onError: a Web-Speech-style code. onStatus: progress text. onState: listening / interpreting / idle. */
  constructor(private onText: (text: string) => void, private onError: (code: string) => void,
              private onStatus: (text: string) => void = () => {}, private onState: (s: VoiceState) => void = () => {}) {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    this.supported = !!Ctor || (typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
    if (!Ctor) return;
    const r = (this.rec = new Ctor());
    r.lang = 'en-US'; r.interimResults = false; r.continuous = false;
    r.onresult = e => { this.heard = Array.from(e.results).map(x => x[0].transcript).join(' '); };
    r.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') this.browserFailed = e.error; };
    r.onend = () => { this.browserText = this.heard; this.heard = ''; if (this.browserText) this.offer(this.browserText, this.turn, false); };
  }

  get listening() { return this.state === 'listening'; }
  private set(s: VoiceState) { if (s !== this.state) { this.state = s; this.onState(s); } }

  /** Download the Whisper model in the background so the first command does not wait for it. */
  warm() {
    if (typeof MediaRecorder === 'undefined') return;
    this.onStatus('Getting voice ready (one-time, about 40 MB)...');
    loadWhisper(p => this.onStatus(`Getting voice ready... ${Math.round(p)}%`)).then(() => this.onStatus('Voice is ready. Tap the mic and speak.'), () => { /* retried on the first command */ });
  }

  /** The mic button: start listening, or stop and interpret. A tap while interpreting is ignored. */
  toggle() {
    if (this.state === 'idle') void this.begin();
    else if (this.state === 'listening') this.stopListening(true);
  }

  private async begin() {
    const turn = ++this.turn;
    this.done = false; this.heard = ''; this.browserText = ''; this.browserFailed = '';
    this.set('listening'); // immediate feedback; the first tap may wait for the permission prompt
    try {
      if (typeof MediaRecorder === 'undefined') throw new DOMException('no recorder', 'NotSupportedError');
      this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: false } }); // noise suppression can eat short words
    } catch (err) {
      this.set('idle');
      this.onError((err as DOMException).name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture');
      return;
    }
    if (turn !== this.turn || this.state !== 'listening') return; // stopped while the permission prompt was open
    try { this.rec?.start(); } catch { /* already started */ }
    this.chunks = [];
    const r = (this.recorder = new MediaRecorder(this.stream));
    r.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    r.start();
    this.watchLevel(turn);
  }

  /** Level meter plus end-of-speech detection: stop ~1 s after the user falls silent, 6 s if they never speak, 8 s at most. */
  private watchLevel(turn: number) {
    const ctx = new AudioContext(), an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(this.stream!).connect(an);
    const buf = new Float32Array(an.fftSize) as Float32Array<ArrayBuffer>;
    let floor = Infinity, spoke = false, quietSince = performance.now();
    const timer = window.setInterval(() => {
      an.getFloatTimeDomainData(buf);
      const lvl = rms(buf), now = performance.now(), elapsed = now - this.startedAt;
      this.micLevel = Math.min(1, lvl * 12);
      if (elapsed < 400) floor = Math.min(floor, lvl);                    // room noise, measured in the first 400 ms
      const loud = lvl > Math.max(0.0015, floor * 2.5); // relative to the room noise; the floor only guards digital silence
      if (loud) { spoke = true; quietSince = now; }
      if (turn !== this.turn) return;
      if ((spoke && now - quietSince > END_SILENCE_MS) || elapsed > MAX_MS || (!spoke && elapsed > NO_SPEECH_MS)) this.stopListening(false);
    }, 60);
    this.level = { ctx, an, buf, timer };
  }
  private stopWatching() { if (this.level) { clearInterval(this.level.timer); void this.level.ctx.close(); this.level = undefined; } this.micLevel = 0; }

  private stopListening(manual: boolean) {
    const turn = this.turn;
    if (this.state !== 'listening') return;
    this.stopWatching();
    this.set('interpreting'); // from here until a command is found the UI shows "Interpreting..."
    window.setTimeout(() => { try { this.rec?.stop(); } catch { /* not running */ } void this.finish(turn); }, manual ? TAIL_MS : 0);
  }

  private async finish(turn: number) {
    const r = this.recorder;
    if (!r || r.state === 'inactive') return this.fallback(turn);
    const blob = await new Promise<Blob>(res => { r.onstop = () => res(new Blob(this.chunks, { type: r.mimeType })); r.stop(); });
    if (performance.now() - this.startedAt < MIN_MS || turn !== this.turn) return this.fallback(turn);
    try {
      let pcm = await toPcm(blob);
      const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      if (peak < 0.004 || rms(pcm) < 0.0007) return this.fallback(turn);  // only room noise
      const g = Math.min(30, 0.9 / peak); pcm = pcm.map(v => v * g);        // normalise: a quiet mic is not a different transcript
      const text = await transcribe(pcm);
      if (text) this.offer(text, turn, true);
      else this.fallback(turn);
    } catch (err) {
      console.warn('whisper failed', err);
      if (turn === this.turn && !this.done && !this.browserText) { this.set('idle'); this.onError(this.browserFailed || 'model-unavailable'); }
    }
  }

  /** Deliver a transcript once per turn: a recognised command at once, anything else only from Whisper. */
  private offer(text: string, turn: number, fromWhisper: boolean) {
    if (turn !== this.turn || this.done) return;
    if (parseCommand(text) || fromWhisper) { this.done = true; this.set('idle'); this.onText(text); }
  }

  /** Whisper had nothing: fall back to what the browser heard, or say that nothing came through. */
  private fallback(turn: number) {
    if (turn !== this.turn || this.done) return;
    this.done = true; this.set('idle');
    if (this.browserText) this.onText(this.browserText);
    else if (this.browserFailed) this.onError(this.browserFailed);
    else this.onError('no-speech');
  }

  abort() { this.turn++; this.done = true; this.heard = ''; this.stopWatching(); this.rec?.abort(); if (this.recorder?.state === 'recording') this.recorder.stop(); this.set('idle'); }
  /** Close the microphone (the browser's recording light goes off). */
  release() { this.abort(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined; this.recorder = undefined; }
}
