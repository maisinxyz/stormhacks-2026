// play.md B.4: pseudo-AR. Device orientation drives the 3D camera so the dog stays anchored in the room while the
// phone turns. No translation tracking (walking toward the dog does not change its size) — the universal-tier limit.
import * as THREE from 'three';

export const CAMERA_HEIGHT = 1.4; // assumed phone height above the floor (m)
export const START_DISTANCE = 2;  // dog starts this far ahead (m)
export const CAMERA_FOV = 60;     // vertical fov of a typical phone rear camera in portrait; calibrate per device if needed

export type OrientationStatus = 'granted' | 'denied' | 'unavailable' | 'mouse';

const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
const SCREEN_FIX = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90deg about X: device "up" -> camera "forward"
const rad = THREE.MathUtils.degToRad;

export class PhonePose {
  status: OrientationStatus = 'unavailable';
  /** rad/s, smoothed: how fast the phone is turning (B.6 uses this for startle reactions). */
  angularSpeed = 0;
  private raw = new THREE.Quaternion();   // latest device orientation, world-from-camera
  private yawFix = new THREE.Quaternion(); // recenter offset about +Y
  private target = new THREE.Quaternion();
  private have = false;
  private mouse = { yaw: 0, pitch: -0.42 }; // ?orient=mouse simulation
  private simulate = new URLSearchParams(location.search).get('orient') === 'mouse';
  private needRecenter = true;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Call inside a user gesture: iOS only grants motion access from a tap. */
  async start(): Promise<OrientationStatus> {
    if (this.simulate) return (this.status = 'mouse');
    const DOE = window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }) | undefined;
    if (!DOE) return (this.status = 'unavailable');
    if (typeof DOE.requestPermission === 'function') {
      const r = await DOE.requestPermission().catch(() => 'denied' as const);
      if (r !== 'granted') return (this.status = 'denied');
    }
    window.addEventListener('deviceorientation', this.onOrient);
    this.needRecenter = true;
    // Desktop browsers define the event but never fire it with data: report unavailable if nothing arrives.
    await new Promise(r => setTimeout(r, 400));
    return (this.status = this.have ? 'granted' : 'unavailable');
  }

  stop() { window.removeEventListener('deviceorientation', this.onOrient); this.have = false; }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const orient = rad((screen.orientation?.angle ?? (window.orientation as number | undefined) ?? 0));
    // W3C device orientation (Z-X'-Y'') -> three.js camera quaternion
    this.raw.setFromEuler(new THREE.Euler(rad(e.beta), rad(e.alpha), -rad(e.gamma), 'YXZ'))
      .multiply(SCREEN_FIX)
      .multiply(new THREE.Quaternion().setFromAxisAngle(Z, -orient));
    this.have = true;
    if (this.status === 'unavailable') this.status = 'granted';
  };

  /** ?orient=mouse: drag to look around (desktop dev / Playwright). */
  look(dxPx: number, dyPx: number) {
    this.mouse.yaw -= dxPx * 0.005;
    this.mouse.pitch = THREE.MathUtils.clamp(this.mouse.pitch - dyPx * 0.005, -1.4, 1.2);
  }
  get simulated() { return this.simulate || !this.have; }

  /** Re-zero yaw so the anchor is straight ahead again (gyro yaw drifts). */
  recenter() { this.needRecenter = true; }

  private applyRecenter() {
    // current forward on the ground plane -> rotate about Y so it points at -Z (toward the anchor)
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.raw);
    if (Math.hypot(f.x, f.z) < 0.15) return; // pointing straight up/down: yaw undefined, try again next frame
    this.yawFix.setFromAxisAngle(Y, Math.PI - Math.atan2(f.x, f.z));
    this.needRecenter = false;
  }

  /** Per frame: pose the camera. Position is fixed (no translation tracking). */
  update(dt: number) {
    const cam = this.camera;
    cam.position.set(0, CAMERA_HEIGHT, START_DISTANCE);
    if (cam.fov !== CAMERA_FOV) { cam.fov = CAMERA_FOV; cam.updateProjectionMatrix(); }
    if (this.have && !this.simulate) {
      if (this.needRecenter) this.applyRecenter();
      this.target.copy(this.yawFix).multiply(this.raw);
    } else {
      // no sensor (desktop, or permission denied): fixed/simulated look toward the anchor
      this.target.setFromEuler(new THREE.Euler(this.mouse.pitch, this.mouse.yaw, 0, 'YXZ'));
    }
    const before = cam.quaternion.clone();
    if (dt <= 0) cam.quaternion.copy(this.target); // first frame: snap
    else cam.quaternion.slerp(this.target, 1 - Math.exp(-dt * 14)); // low-pass: hides sensor jitter
    const speed = dt > 0 ? before.angleTo(cam.quaternion) / dt : 0;
    this.angularSpeed += (speed - this.angularSpeed) * Math.min(1, dt * 6);
  }
}
