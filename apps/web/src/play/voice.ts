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

const MIN_MS = 350, MIN_RMS = 0.006; // shorter or quieter than this is a tap or silence, not a command

/** Hold-to-talk. Two recognizers run side by side: the browser's own (fast, but needs Google/Apple's service) and
 *  Whisper on the device (works anywhere). A phrase that parses as a command wins immediately; otherwise the Whisper
 *  transcript is used. Each press yields at most one result. */
export class PushToTalk {
  private rec?: Recognition;
  private heard = '';
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private opening?: Promise<void>;
  private turn = 0;
  private done = false;
  private browserText = '';
  private browserFailed = '';
  readonly supported: boolean;

  /** onText: what was heard. onError: a Web-Speech-style code plus a reason. onStatus: progress text for the UI. */
  constructor(private onText: (text: string) => void, private onError: (code: string) => void, private onStatus: (text: string) => void = () => {}) {
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

  /** Download the Whisper model in the background so the first press does not wait for it. */
  warm() {
    if (typeof MediaRecorder === 'undefined') return;
    this.onStatus('Getting voice ready (one-time, about 40 MB)...');
    loadWhisper(p => this.onStatus(`Getting voice ready... ${Math.round(p)}%`)).then(() => this.onStatus('Voice is ready. Hold the mic and speak.'), () => { /* retried on the first press */ });
  }

  /** Hold to talk: start on press, stop on release. */
  start() {
    this.turn++; this.done = false; this.heard = ''; this.browserText = ''; this.browserFailed = '';
    try { this.rec?.start(); } catch { /* already started */ }
    this.opening = this.openRecorder().catch(err => { this.onError((err as DOMException).name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture'); });
  }

  private async openRecorder() {
    if (typeof MediaRecorder === 'undefined') return;
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    const r = (this.recorder = new MediaRecorder(this.stream));
    r.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    r.start();
  }

  stop() {
    const turn = this.turn;
    try { this.rec?.stop(); } catch { /* not running */ }
    void this.finish(turn);
  }

  private async finish(turn: number) {
    await this.opening;
    const r = this.recorder;
    if (!r || r.state === 'inactive') return this.fallback(turn);
    const blob = await new Promise<Blob>(res => { r.onstop = () => res(new Blob(this.chunks, { type: r.mimeType })); r.stop(); });
    if (performance.now() - this.startedAt < MIN_MS || turn !== this.turn) return this.fallback(turn);
    try {
      const pcm = await toPcm(blob);
      if (rms(pcm) < MIN_RMS) return this.fallback(turn); // nothing but room noise
      this.onStatus('Listening...');
      const text = await transcribe(pcm);
      if (text) this.offer(text, turn, true);
      else this.fallback(turn);
    } catch (err) {
      console.warn('whisper failed', err);
      if (turn === this.turn && !this.done && !this.browserText) this.onError(this.browserFailed || 'model-unavailable');
    }
  }

  /** Deliver a transcript once per press: a recognised command at once, anything else only from Whisper. */
  private offer(text: string, turn: number, fromWhisper: boolean) {
    if (turn !== this.turn || this.done) return;
    if (parseCommand(text) || fromWhisper) { this.done = true; this.onText(text); }
  }

  /** Whisper had nothing: fall back to what the browser heard, or say that nothing came through. */
  private fallback(turn: number) {
    if (turn !== this.turn || this.done) return;
    if (this.browserText) { this.done = true; this.onText(this.browserText); }
    else if (this.browserFailed) this.onError(this.browserFailed);
    else this.onError('no-speech');
  }

  abort() { this.turn++; this.done = true; this.heard = ''; this.rec?.abort(); if (this.recorder?.state === 'recording') this.recorder.stop(); }
  /** Close the microphone (the browser's recording light goes off). */
  release() { this.abort(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined; this.recorder = undefined; }
}
