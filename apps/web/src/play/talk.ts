// Talking to the pet: the mic turn, what was heard, and the "always does something" fallbacks.
// ponytail: used by the first-person room. The camera view still carries its own copy of this glue (its harness reaches
// into it); fold the two together when that harness is next touched.
import { interpret, type CommandId } from './commands';
import { PushToTalk, type VoiceState } from './voice';

const SLOW_MS = 4000, LATE_MS = 8000; // no command within 4 s -> wag + hearts; an answer later than 8 s is dropped
const VOICE_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser to talk to your pet.',
  'audio-capture': 'No microphone found.',
  'unavailable': 'Voice is unavailable: the server has no working ElevenLabs key (or it is out of credits).',
  'network': 'Lost the connection to the speech service. Try again.',
};

export interface TalkHost {
  toast(text: string, ms?: number): void;
  setVoice(state: VoiceState): void;
  micLevel(v: number): void;
  /** The pet pricks up its ears while the mic is open. */
  listening(on: boolean): void;
  run(id: CommandId): void;
  /** Nothing understood, nothing heard, or the answer is slow: a happy wag and hearts. */
  love(): void;
}

export class Talk {
  readonly voice: PushToTalk;
  private slowTimer = 0; private levelTimer = 0; private interpretingSince = 0;

  /** `extra`: more words the recognizer should favour on top of the commands (not the pet's name, see voice.ts). */
  constructor(private h: TalkHost, extra: string[] = []) {
    this.voice = new PushToTalk(t => this.heard(t), code => this.failed(code), text => h.toast(text, 4000), s => this.state(s), extra);
    this.voice.warm();
  }
  toggle() { this.voice.toggle(); }

  /** What was said becomes the nearest command (also the entry point for typed test phrases). */
  heard(text: string) {
    window.clearTimeout(this.slowTimer);
    const late = this.interpretingSince > 0 && performance.now() - this.interpretingSince > LATE_MS;
    this.interpretingSince = 0;
    if (late) return;
    const m = interpret(text);
    this.h.toast(m ? `Heard "${text}" → ${m.label}` : `Heard "${text}"`, 3000);
    if (m) this.h.run(m.id); else this.h.love();
  }
  private state(s: VoiceState) {
    this.h.setVoice(s); this.h.listening(s !== 'idle');
    window.clearInterval(this.levelTimer);
    if (s === 'listening') this.levelTimer = window.setInterval(() => this.h.micLevel(this.voice.micLevel), 60);
    window.clearTimeout(this.slowTimer);
    if (s === 'interpreting') { this.interpretingSince = performance.now(); this.slowTimer = window.setTimeout(() => this.h.love(), SLOW_MS); }
  }
  private failed(code: string) {
    window.clearTimeout(this.slowTimer);
    if (VOICE_ERRORS[code]) this.h.toast(VOICE_ERRORS[code], 6000);
    if (code === 'no-speech') this.h.love(); // nothing was said: still a happy pet. A broken mic or service only shows the message.
  }
  dispose() { window.clearTimeout(this.slowTimer); window.clearInterval(this.levelTimer); this.voice.release(); }
}
