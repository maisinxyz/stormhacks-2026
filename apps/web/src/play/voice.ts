// Voice input for the Play shell (play.md B.7 / A.7): one mic turn in, the words out. commands.ts decides what they mean.
// The words come from ElevenLabs Scribe (../voice/scribe.ts), streamed live. There is no other recognizer.
import { COMMANDS, interpret, SURE } from './commands';
import { ScribeListener, scribeSupported, warmScribe } from '../voice/scribe';

const MAX_MS = 8000;                // hard stop
const NO_SPEECH_MS = 6000;          // gives up if nothing is said

export type VoiceState = 'idle' | 'listening' | 'interpreting';

// words the recognizer should favour: the commands themselves, and the short ones it would otherwise mishear
const KEYTERMS = [...COMMANDS.map(c => c.label.toLowerCase()), 'sit', 'paw', 'come', 'down', 'good boy', 'good girl', 'stay', 'fetch', 'treat', 'spin'];

/** Tap to start, tap again to stop (it also stops by itself when you finish speaking). A clear command is acted on
 *  while the user is still finishing the sentence. Each turn yields at most one result: onText or onError. */
export class PushToTalk {
  private scribe: ScribeListener;
  private state: VoiceState = 'idle';
  private turn = 0;
  private maxTimer = 0; private quietTimer = 0;
  readonly supported = scribeSupported();

  /** onText: what was heard. onError: 'no-speech' | 'not-allowed' | 'audio-capture' | 'unavailable' | 'network'.
   *  onStatus: progress text. onState: listening / interpreting / idle. `extra`: more words to favour. Do NOT pass the
   *  pet's name: measured, a pet called Biscuit turned "sit" into "Biscuit". */
  constructor(private onText: (text: string) => void, private onError: (code: string) => void,
              _onStatus: (text: string) => void = () => {}, private onState: (s: VoiceState) => void = () => {}, extra: string[] = []) {
    this.scribe = new ScribeListener([...new Set([...KEYTERMS, ...extra.map(n => n.toLowerCase())])]);
  }

  /** 0..1 loudness while listening (drives the button's pulse). */
  get micLevel() { return this.scribe.level; }
  get listening() { return this.state === 'listening'; }
  private set(s: VoiceState) { if (s !== this.state) { this.state = s; this.onState(s); } }

  /** Get a speech token ready so the first tap opens the mic at once. */
  warm() { if (this.supported) warmScribe(); }

  /** The mic button: start listening, or stop and interpret. A tap while interpreting is ignored. */
  toggle() {
    if (this.state === 'idle') this.begin();
    else if (this.state === 'listening') this.stop();
  }

  private begin() {
    const turn = ++this.turn;
    let spoke = false;
    this.set('listening'); // immediate feedback; the first tap may wait for the permission prompt
    const end = (fn: () => void) => { if (turn !== this.turn) return; this.turn++; this.clear(); this.set('idle'); fn(); };
    void this.scribe.start({
      onPartial: text => {
        if (turn !== this.turn) return;
        spoke = true;
        // heard a clear command while the user was still speaking: act now
        if ((interpret(text)?.score ?? 0) >= SURE) { this.scribe.abort(); end(() => this.onText(text)); }
      },
      onFinal: text => end(() => text ? this.onText(text) : this.onError('no-speech')),
      onError: code => end(() => this.onError(code)),
    });
    this.maxTimer = window.setTimeout(() => { if (turn === this.turn) this.stop(); }, MAX_MS);
    this.quietTimer = window.setTimeout(() => { if (turn === this.turn && !spoke) { this.scribe.abort(); end(() => this.onError('no-speech')); } }, NO_SPEECH_MS);
  }

  private stop() {
    if (this.state !== 'listening') return;
    this.set('interpreting'); // from here until the words arrive the UI shows "Interpreting..."
    this.scribe.stop();
  }
  private clear() { window.clearTimeout(this.maxTimer); window.clearTimeout(this.quietTimer); }

  abort() { this.turn++; this.clear(); this.scribe.abort(); this.set('idle'); }
  /** Close the microphone (the browser's recording light goes off). */
  release() { this.abort(); this.scribe.release(); }
}
