// play.md B.5 (stretch tier): true AR on Android Chrome via WebXR. Hit-testing finds the real floor and the session's
// camera pose replaces the gyro, so walking around the dog works. Never shown on iOS (no browser WebXR AR).
// UNTESTED ON A DEVICE: desktop browsers cannot start an immersive-ar session. Feature-detected, and any failure
// falls back to the gyro tier.
import * as THREE from 'three';
import type { Engine } from '../../engine';

export async function xrSupported(): Promise<boolean> {
  return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
}

export class XrTier {
  active = false;
  /** True once a real floor has been found and the dog placed on it. */
  anchored = false;
  private session?: XRSession;
  private hits?: XRHitTestSource;
  private ref?: XRReferenceSpace | null;

  constructor(private engine: Engine, private overlay: HTMLElement, private onEnd: () => void) {}

  /** Call from a user gesture. Throws if the session cannot start (caller keeps the gyro tier). */
  async start() {
    const r = this.engine.webgl;
    const session = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: this.overlay }, // keeps our edge controls and tap handling on top of the AR view
    });
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local');
    await r.xr.setSession(session);
    this.ref = r.xr.getReferenceSpace();
    const viewer = await session.requestReferenceSpace('viewer');
    this.hits = await session.requestHitTestSource!({ space: viewer });
    session.addEventListener('end', this.ended);
    this.session = session;
    this.active = true;
    this.anchored = false;
  }

  /** Per frame: use the centre-of-view hit test as the floor. The first hit places the dog; later hits refine the height. */
  update(frame?: XRFrame) {
    if (!this.active || !frame || !this.hits || !this.ref) return;
    const pose = frame.getHitTestResults(this.hits)[0]?.getPose(this.ref);
    if (!pose) return;
    const p = pose.transform.position;
    if (!this.anchored) {
      this.anchored = true;
      this.engine.setGroundHeight(p.y);
      this.engine.placePet(p.x, p.z, false);
    }
  }

  /** Floor point under the centre of the view (for "bring the dog here"), if a surface is currently detected. */
  centreHit(frame?: XRFrame): THREE.Vector3 | undefined {
    if (!frame || !this.hits || !this.ref) return undefined;
    const p = frame.getHitTestResults(this.hits)[0]?.getPose(this.ref)?.transform.position;
    return p && new THREE.Vector3(p.x, p.y, p.z);
  }

  stop() { void this.session?.end().catch(() => { /* already ended */ }); }

  private ended = () => {
    this.hits?.cancel();
    this.hits = undefined; this.session = undefined; this.active = false; this.anchored = false;
    this.engine.webgl.xr.enabled = false;
    this.engine.setGroundHeight(0);
    this.onEnd();
  };
}
