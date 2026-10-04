// Push-to-talk voice for the Play shell (play.md B.7 / A.7). Web Speech API + the local-intent table from PRD.md 2.4.
// ponytail: browser speech recognition only (Chrome, Safari); swap in the F2 ElevenLabs Scribe path when the Play shell
// shares a build with apps/desk.
import type { LocalIntent } from '@fetch/contracts';

export type VoiceCommand = { kind: 'intent'; intent: LocalIntent } | { kind: 'praise' } | { kind: 'feed' };

const TABLE: [RegExp, VoiceCommand][] = [
  [/\broll over\b/, { kind: 'intent', intent: 'roll_over' }],
  [/\bplay dead\b/, { kind: 'intent', intent: 'play_dead' }],
  [/\b(fetch|get the ball|ball)\b/, { kind: 'intent', intent: 'fetch_ball' }],
  [/\bgood (boy|girl|pet|dog|bird)\b/, { kind: 'praise' }],
  [/\b(treat|feed|dinner|food)\b/, { kind: 'feed' }],
  [/\bwake( up)?\b/, { kind: 'intent', intent: 'wake' }],
  [/\b(sleep|nap|bed ?time)\b/, { kind: 'intent', intent: 'sleep' }],
  [/\bsit\b/, { kind: 'intent', intent: 'sit' }],
  [/\bstay\b/, { kind: 'intent', intent: 'stay' }],
  [/\b(come|here)\b/, { kind: 'intent', intent: 'come' }],
  [/\b(speak|bark)\b/, { kind: 'intent', intent: 'speak' }],
  [/\bspin\b/, { kind: 'intent', intent: 'spin' }],
  [/\b(shake|paw)\b/, { kind: 'intent', intent: 'shake' }],
  [/\bdance\b/, { kind: 'intent', intent: 'dance' }],
  [/\bhide\b/, { kind: 'intent', intent: 'hide' }],
  [/\btrick\b/, { kind: 'intent', intent: 'trick' }],
  [/\bstop\b/, { kind: 'intent', intent: 'stop' }],
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

export class PushToTalk {
  private rec?: Recognition;
  private heard = '';
  readonly supported: boolean;

  constructor(private onText: (text: string) => void, private onError: (code: string) => void) {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    this.supported = !!Ctor;
    if (!Ctor) return;
    const r = (this.rec = new Ctor());
    r.lang = 'en-US'; r.interimResults = false; r.continuous = false;
    r.onresult = e => { this.heard = Array.from(e.results).map(x => x[0].transcript).join(' '); };
    r.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') this.onError(e.error); };
    r.onend = () => { if (this.heard) this.onText(this.heard); this.heard = ''; };
  }

  /** Hold to talk: start on press, stop on release. */
  start() { this.heard = ''; try { this.rec?.start(); } catch { /* already started */ } }
  stop() { this.rec?.stop(); }
  abort() { this.heard = ''; this.rec?.abort(); }
}
