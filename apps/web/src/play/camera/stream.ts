// play.md B.3: the live camera layer. Rear camera by default, flip, error codes, re-acquire on resume,
// and a ?video=<url> mock so desktop and Playwright can run without a camera.
import type { ShellErrorCode } from '../types';

export type Facing = 'environment' | 'user';
export class StreamError extends Error {
  constructor(public code: ShellErrorCode, message: string) { super(message); }
}

export class CameraStream {
  readonly video = document.createElement('video');
  facing: Facing = 'environment';
  private stream?: MediaStream;
  private wanted = false;
  private mock = new URLSearchParams(location.search).get('video');

  constructor() {
    const v = this.video;
    v.playsInline = true; v.muted = true; v.autoplay = true; // iOS: all three or it opens fullscreen / refuses to play
    v.setAttribute('playsinline', '');
    v.className = 'play-video';
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get active() { return !!this.stream || (!!this.mock && !this.video.paused); }
  get isMock() { return !!this.mock; }

  /** Resolves once the first frame is ready. Call from a user gesture on iOS. */
  async start(facing: Facing = this.facing) {
    this.wanted = true;
    this.facing = facing;
    this.stopTracks();
    if (this.mock) {
      this.video.src = this.mock; this.video.loop = true; this.video.crossOrigin = 'anonymous';
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new StreamError('camera_unavailable', 'This browser cannot open the camera (HTTPS is required).');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (e) {
        const name = (e as DOMException).name;
        if (name === 'NotAllowedError' || name === 'SecurityError') throw new StreamError('camera_denied', 'Camera permission was denied.');
        throw new StreamError('camera_unavailable', name === 'NotFoundError' ? 'No camera found on this device.' : `Camera failed to start (${name}).`);
      }
      this.video.srcObject = this.stream;
    }
    // Selfie preview mirrors; the dog never does. Ask the track which way it faces: a laptop asked for the rear camera
    // still opens its only (front) one, and reports no facingMode at all.
    const real = this.stream?.getVideoTracks()[0]?.getSettings().facingMode;
    const front = real ? real === 'user' : facing === 'user' || !matchMedia('(pointer: coarse)').matches;
    this.video.classList.toggle('mirrored', !this.mock && front);
    await this.video.play().catch(() => { /* autoplay may need the gesture; first frame wait below still resolves or times out */ });
    await this.firstFrame();
  }

  private firstFrame() {
    return new Promise<void>((res, rej) => {
      if (this.video.readyState >= 2) return res();
      const t = setTimeout(() => rej(new StreamError('camera_unavailable', 'Camera did not deliver a frame.')), 8000);
      this.video.addEventListener('loadeddata', () => { clearTimeout(t); res(); }, { once: true });
      this.video.addEventListener('error', () => { clearTimeout(t); rej(new StreamError('camera_unavailable', 'The camera feed could not be played.')); }, { once: true });
    });
  }

  flip() { return this.start(this.facing === 'environment' ? 'user' : 'environment'); }

  /** Release the camera (light off). */
  stop() { this.wanted = false; this.stopTracks(); this.video.pause(); }

  private stopTracks() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
    this.video.srcObject = null;
  }

  // Tab hidden: release. Visible again: re-acquire without a reload.
  private onVisibility = () => {
    if (!this.wanted) return;
    if (document.hidden) { this.stopTracks(); this.video.pause(); }
    else void this.start().catch(() => { /* surfaced on next explicit start */ });
  };

  dispose() { this.stop(); document.removeEventListener('visibilitychange', this.onVisibility); this.video.remove(); }
}
