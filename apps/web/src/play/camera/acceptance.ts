// play.md B.13 acceptance run for the camera view: open /camera.html?accept=camera (dev only).
// Results land in window.__acceptCamera and in a table on the page.
// Runs on a desktop browser with a FAKE camera (canvas stream) and SYNTHETIC device-orientation events, so it proves
// the logic, not real phone hardware: permission prompts, sensor noise, thermal limits and WebXR still need a device.
import * as THREE from 'three';
import type { Mood } from '@fetch/contracts';
import { MOODS } from '../../engine/anim';
import type { PlayShell } from '../shell';
import { interpret, SELF_CHECK } from '../commands';
import { AR_PET_SCALE } from './camera';
import { composite } from './capture';
import { CAMERA_FOV } from './pose';

type Row = { id: string; criterion: string; pass: boolean | null; detail: string };
type Any = any; // reaches into privates for measurement

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms: number) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await sleep(25); return performance.now() - t0; };
const fire = (type: string, x: number, y: number, id = 1) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: id }));
const orient = (alpha: number, beta = 75, gamma = 0) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma }));

export async function run(shell: PlayShell) {
  const sh = shell as Any, e = shell.engine as Any, rows: Row[] = [];
  const add = (id: string, criterion: string, pass: boolean | null, detail: string) => { rows.push({ id, criterion, pass, detail }); console.log(pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL', id, detail); };
  const cam = sh.views.get('camera') as Any;
  const events: string[] = [];
  const realEmit = sh.context.bind(sh);
  sh.context = () => { const c = realEmit(); c.emit = (ev: Any) => events.push(`${ev.type}:${ev.view}${ev.code ? ':' + ev.code : ''}`); return c; };

  // ---- fake camera: a canvas stream behind getUserMedia, so real MediaStream tracks start and stop ----
  const feed = document.createElement('canvas');
  feed.width = 360; feed.height = 640;
  const fx = feed.getContext('2d')!;
  const paint = () => { const g = fx.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, '#8fb3d9'); g.addColorStop(0.55, '#d9c9a8'); g.addColorStop(1, '#7a6a55'); fx.fillStyle = g; fx.fillRect(0, 0, 360, 640); fx.fillStyle = '#fff'; fx.fillRect((performance.now() / 20) % 360, 40, 12, 12); };
  const painter = setInterval(paint, 66); paint();
  const tracks: MediaStreamTrack[] = [];
  let deny = false;
  const md = navigator.mediaDevices as Any, realGum = md.getUserMedia?.bind(md);
  md.getUserMedia = async () => {
    if (deny) throw new DOMException('denied by test', 'NotAllowedError');
    const s = (feed as Any).captureStream(15) as MediaStream;
    tracks.push(...s.getTracks());
    return s;
  };
  const pos = () => e.petPosition as THREE.Vector3;
  const ndc = () => { const p = pos(); p.y += 0.2 * e.scaleNow; return p.project(e.camera); };
  const screenOf = () => { const n = ndc(); return [((n.x + 1) / 2) * innerWidth, ((1 - n.y) / 2) * innerHeight] as const; };
  const gyro = () => { window.addEventListener('deviceorientation', cam.pose.onOrient); orient(0); }; // desktop has no sensor: feed events ourselves

  try {
    await until(() => sh.current?.id === 'room', 5000);
    await sleep(600);

    // B13-2 (first half): camera denied from the Room keeps the Room
    deny = true;
    (document.querySelector('[data-action="camera"]') as HTMLElement).click();
    await sleep(1600);
    const deniedOk = sh.current?.id === 'room' && !document.querySelector('video') && !!document.querySelector('.room-ui') && events.some(x => x === 'view.error:camera:camera_denied');
    const notice = document.querySelector('.play-notice')?.textContent ?? '';
    deny = false;

    // B13-1: camera button -> full-screen camera + dog, no card
    const t0 = performance.now();
    (document.querySelector('[data-action="camera"]') as HTMLElement).click();
    const openMs = await until(() => sh.current?.id === 'camera' && cam.live, 6000);
    await sleep(700);
    const v = document.querySelector('video')!, r = v.getBoundingClientRect();
    const full = Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2 && r.left === 0 && r.top === 0;
    const noCard = (document.querySelector('.cam-card') as HTMLElement).hidden && !document.querySelector('.room-ui') && v.parentElement === document.getElementById('play-root');
    const dogOn = e.splat.mesh.visible && Math.abs(ndc().x) < 1 && Math.abs(ndc().y) < 1;
    add('open', 'B.13-1 camera full-screen + dog within 1.5 s, no card', openMs < 1500 && full && noCard && dogOn && !v.paused,
      `${Math.round(performance.now() - t0 - 700)} ms from tap to live (includes the 0.25 s fade), video ${Math.round(r.width)}x${Math.round(r.height)} of ${innerWidth}x${innerHeight}, playing ${!v.paused}`);
    add('permissions', 'B.13-2 permissions from one tap, recover from denial', deniedOk && cam.live ? null : false,
      `simulated denial: stayed in Room ${deniedOk}, notice "${notice.slice(0, 60)}", retry opened camera ${cam.live}. Real iOS/Android prompts NOT exercised`);

    // B13-3: anchoring under synthetic gyro
    e.placePet(0, 0, false); e.doIntent('sleep'); // asleep = guaranteed stationary while we measure the camera, not the dog
    gyro(); cam.pose.recenter(); orient(0); await sleep(900);
    const w0 = pos(), x0 = ndc().x;
    orient(15); await sleep(600); // turn left 15 deg: the scene must slide right
    const w1 = pos(), x1 = ndc().x;
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) { orient(15 + (Math.random() - 0.5) * 0.5, 75 + (Math.random() - 0.5) * 0.5); await sleep(25); xs.push(ndc().x); } // sensor noise
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length, jitter = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    orient(55); await sleep(500); const drifted = ndc().x;
    cam.pose.recenter(); orient(55); await sleep(600); const recentred = ndc().x;
    e.doIntent('wake');
    add('anchor', 'B.13-3 dog stays anchored while turning, no jitter, recenter fixes drift',
      w0.distanceTo(w1) < 0.15 && x1 - x0 > 0.2 && jitter < 0.01 && Math.abs(recentred) < 0.15 && Math.abs(drifted) > 0.5,
      `world moved ${w0.distanceTo(w1).toFixed(2)} m during a 15 deg turn, screen x ${x0.toFixed(2)} -> ${x1.toFixed(2)}, jitter sd ${jitter.toFixed(4)} ndc under +-0.25 deg noise, drifted ${drifted.toFixed(2)} -> recentred ${recentred.toFixed(2)} [synthetic sensor]`);

    // B13-4: floor + scale across tilt
    e.placePet(0, 0, false); e.doIntent('stop'); await sleep(900);
    // A clip may lower the body (sit, lie down): that offset is authored for a 1-unit pet, so on the floor plane the
    // pet's height must be exactly clipOffset * scale, never the unscaled offset (which sinks a 0.45 m dog into the floor).
    const errs: number[] = [], scales: number[] = [];
    for (const [intent, beta] of [['stop', 55], ['sit', 70], ['sleep', 85], ['stop', 100]] as const) {
      e.doIntent(intent); orient(55, beta); await sleep(900);
      const clipY = (e.beh.anim.pose.y ?? 0) + MOODS[e.beh.mood as Mood].y; // clip offset + mood posture, in 1-unit pet space
      errs.push(Math.abs(e.splat.mesh.position.y - (e.beh.y + clipY * e.scaleNow)));
      scales.push(e.splat.mesh.scale.x);
    }
    e.doIntent('wake');
    add('floor', 'B.13-4 feet on the floor plane, natural scale as the phone tilts',
      Math.max(...errs) < 0.03 && scales.every(sc => Math.abs(sc - AR_PET_SCALE) < 1e-6) && Math.abs(e.shadow.position.y - 0.002) < 1e-6,
      `height error vs scaled clip offset ${Math.max(...errs).toFixed(3)} m over stand/sit/lie at 4 tilts, scale ${scales[0]} throughout, shadow on the floor (y ${e.shadow.position.y.toFixed(3)})`);

    // B13-5: tap / drag / floor tap / pinch
    cam.pose.recenter(); orient(55, 68); await sleep(700);
    e.placePet(0, 0, false); e.doIntent('stop'); await sleep(900);
    let [x, y] = screenOf();
    const wag = e.pack.clips[e.pack.reactions.pet], h0 = e.stats.happiness;
    fire('pointermove', x, y); fire('pointerdown', x, y); fire('pointerup', x, y);
    const tapMs = await until(() => e.beh.anim.clip === wag && e.look.target === e.camera.position, 1000);
    await sleep(1700);
    [x, y] = screenOf();
    const before = pos();
    fire('pointerdown', x, y, 2); for (let i = 1; i <= 8; i++) { fire('pointermove', x + i * 18, y + i * 4, 2); await sleep(20); }
    const want = cam.groundAt(x + 144, y + 32) as THREE.Vector3; fire('pointerup', x + 144, y + 32, 2); await sleep(150);
    const dragErr = want ? Math.hypot(pos().x - want.x, pos().z - want.z) : 9;
    await sleep(2500);
    const tgt = cam.groundAt(innerWidth * 0.3, innerHeight * 0.8) as THREE.Vector3;
    fire('pointerdown', innerWidth * 0.3, innerHeight * 0.8, 3); fire('pointerup', innerWidth * 0.3, innerHeight * 0.8, 3);
    await sleep(150); await until(() => !e.travelling, 7000);
    const walkErr = Math.hypot(pos().x - tgt.x, pos().z - tgt.z);
    const s0 = e.scaleNow;
    fire('pointerdown', 40, 200, 4); fire('pointerdown', 140, 200, 5); fire('pointermove', 240, 200, 5); await sleep(60); fire('pointerup', 240, 200, 5); fire('pointerup', 40, 200, 4);
    const s1 = e.scaleNow;
    cam.zoom = 1; e.setPetScale(AR_PET_SCALE);
    add('interact', 'B.13-5 tap reaction < 300 ms, drag, floor tap, pinch', tapMs < 300 && e.stats.happiness > h0 && dragErr < 0.25 && before.distanceTo(want ?? before) > 0.1 && walkErr < 0.2 && s1 > s0 * 1.5,
      `tap -> look + wag in ${Math.round(tapMs)} ms, drag landed ${dragErr.toFixed(2)} m from the finger, floor tap walked to within ${walkErr.toFixed(2)} m, pinch ${s0} -> ${s1.toFixed(2)}`);

    // B13-6: never frozen + phone jolt + out-of-frame return
    cam.pose.recenter(); orient(55, 68); e.placePet(0, 0, false); e.doIntent('stop'); await sleep(800);
    const sample = () => JSON.stringify(e.sk.pose.map((q: THREE.Quaternion) => [q.x.toFixed(4), q.y.toFixed(4), q.z.toFixed(4)]));
    const seen = new Set<string>(); const yaws: number[] = [];
    for (let i = 0; i < 60; i++) { seen.add(sample()); yaws.push(e.look.yaw); await sleep(100); }
    const yawRange = Math.max(...yaws) - Math.min(...yaws);
    // command-only: a phone jolt, then 4.5 s out of frame, must not move the dog; a sit must hold
    const p0 = pos();
    for (let i = 0; i < 12; i++) { orient(55 + i * 9, 68); await sleep(16); } // ~500 deg/s jolt, ends out of frame
    await sleep(4500);
    const moved = pos().distanceTo(p0), calm = e.state === 'idle';
    orient(55, 68); e.doIntent('sit'); await sleep(6000);
    const held = e.beh.anim.clip === e.pack.clips[e.pack.intents.sit] && e.state === 'intent';
    e.doIntent('stop'); await sleep(300);
    const stood = e.state === 'idle';
    // follow: turn 60 deg -> the dog walks back in front; "stay there" -> turn back and it does not move
    cam.pose.recenter(); orient(55, 68); await sleep(600); cam.heard('follow me'); orient(115, 68); await sleep(600);
    await until(() => e.travelling, 2000); await until(() => !e.travelling, 9000);
    const followed = Math.abs(ndc().x) < 0.3;
    cam.heard('sit'); const pStay = pos(); orient(55, 68); await sleep(3000);
    const pNow = pos(); const stayed = Math.hypot(pNow.x - pStay.x, pNow.z - pStay.z) < 0.01 && !cam.following; // xz only: sitting lowers the body
    e.doIntent('stop'); cam.pose.recenter(); e.placePet(0, 0, false); await sleep(400);
    add('alive', 'B.13-6 never frozen; moves only on command; a pose holds until the next command',
      seen.size > 40 && yawRange > 0.2 && moved < 0.01 && calm && held && stood && followed && stayed,
      `${seen.size}/60 distinct poses in 6 s idle, head yaw range ${yawRange.toFixed(2)} rad, moved ${moved.toFixed(3)} m after a jolt + 4.5 s out of frame (state ${calm ? 'idle' : 'not idle'}), sit held 6 s: ${held}, "stop" stands: ${stood}, "follow me" + 60 deg turn -> back in front: ${followed}, "stay there" + turn back -> did not move: ${stayed} [synthetic sensor]`);

    // side placement: clear of the user, faces the centre, swaps on command
    cam.pose.recenter(); orient(55, 68); await sleep(600); cam.side = 1; cam.placeSide(false); await sleep(500);
    const sideR = ndc().x, faceR = e.beh.dir;
    cam.side = -1; cam.placeSide(true); await sleep(200); await until(() => !e.travelling, 9000); await sleep(400);
    const sideL = ndc().x, faceL = e.beh.dir;
    cam.side = 1; try { sessionStorage.removeItem('fetch.play.side'); } catch { /* ignore */ }
    e.doIntent('stop'); e.placePet(0, 0, false); await sleep(300);
    add('side', 'B.6 dog stands at the side of the shot, in frame, facing the centre, on either side',
      sideR > 0.25 && sideR < 0.85 && faceR === -1 && sideL < -0.25 && sideL > -0.85 && faceL === 1,
      `screen x ${sideR.toFixed(2)} on the right facing ${faceR === -1 ? 'left' : 'right'}; on the other side x ${sideL.toFixed(2)} facing ${faceL === 1 ? 'right' : 'left'} (aspect ${(innerWidth / innerHeight).toFixed(2)}; portrait checked by screenshot only)`);

    // B13-7: voice -> local intents
    cam.pose.recenter(); orient(55 + 110, 68); await sleep(300);
const bad = SELF_CHECK.filter(([say, want]) => (interpret(say)?.id ?? null) !== want).map(([say, want]) => `"${say}" -> ${interpret(say)?.id ?? 'none'} (want ${want})`);
    // each command, spoken as text, must start a scripted routine; a held pose holds; nonsense gets the wag + hearts
    e.doIntent('stop'); await sleep(300); cam.interpretingSince = performance.now(); cam.heard('sot dawn'); await sleep(900);
    const sat = e.beh.anim.clip === e.pack.clips.sit; await sleep(3500); const stillSat = e.beh.anim.clip === e.pack.clips.sit;
    cam.interpretingSince = performance.now(); cam.heard('lie down'); await sleep(700); const lay = e.beh.anim.clip === e.pack.clips.lie;
    cam.interpretingSince = performance.now(); cam.heard('stand up'); await sleep(700); const stood2 = e.state === 'idle';
    e.placePet(0, 0, false); await sleep(200); const xStart = ndc().x;
    cam.interpretingSince = performance.now(); cam.heard('go left'); await sleep(2600); const xL = ndc().x;
    cam.interpretingSince = performance.now(); cam.heard('go right please'); await sleep(2600); const xR = ndc().x;
    const d0 = pos().distanceTo(e.camera.position); cam.interpretingSince = performance.now(); cam.heard('come here'); await sleep(2600); const d1 = pos().distanceTo(e.camera.position);
    const parts0 = e.props.parts.length; cam.interpretingSince = performance.now(); cam.heard('the weather is nice');
    await until(() => e.props.parts.length > parts0 && e.beh.anim.clip === e.pack.clips.wag, 2500);
    const loved = e.props.parts.length > parts0 && e.beh.anim.clip === e.pack.clips.wag;
    // slow answer: 4 s after "interpreting" starts with no result, the same wag + hearts
    e.doIntent('stop'); await sleep(2600); const parts1 = e.props.parts.length; cam.voiceState('interpreting'); await sleep(3500);
    const early = e.beh.anim.clip === e.pack.clips.wag; // must not fire before the 4 s mark
    await until(() => e.props.parts.length > parts1 && e.beh.anim.clip === e.pack.clips.wag, 3500);
    const slowLove = !early && e.props.parts.length > parts1 && e.beh.anim.clip === e.pack.clips.wag; cam.voiceState('idle');
    e.doIntent('stop'); e.placePet(0, 0, false); e.facePet(1); await sleep(1600); // side-on again (head-on, its shadow reaches under the shutter) and let the hearts fade before the capture test
    add('voice', 'B.13-7 anything said becomes the nearest of the 19 commands (or a wag + hearts); poses hold; slow answers still get a reaction',
      bad.length === 0 && sat && stillSat && lay && stood2 && xL < xStart - 0.1 && xR > xL + 0.1 && d1 < d0 - 0.2 && loved && slowLove ? null : false,
      `${SELF_CHECK.length - bad.length}/${SELF_CHECK.length} phrases resolve as expected${bad.length ? ' (wrong: ' + bad.join('; ') + ')' : ''}; "sot dawn" -> sit ${sat}, still sat after 3.5 s ${stillSat}; "lie down" ${lay}; "stand up" ${stood2}; "go left" moved screen x ${xStart.toFixed(2)} -> ${xL.toFixed(2)}, "go right" -> ${xR.toFixed(2)}; "come here" ${d0.toFixed(2)} m -> ${d1.toFixed(2)} m; nonsense -> wag + hearts ${loved}; 4 s without an answer -> wag + hearts ${slowLove}. Text fed to the matcher: real speech NOT exercised here`);

    // B13-8: capture = camera frame + dog, no UI
    e.doIntent('stop'); e.placePet(0, 0, false); await sleep(600);
    const px = async (b: Blob) => { const im = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d')!; g.drawImage(im, 0, 0); return { g, w: im.width, h: im.height }; };
    const withDog = await px(await composite(v, cam.ctx.canvas, shell.engine, false));
    e.splat.mesh.visible = false; e.shadow.visible = false;
    const noDog = await px(await composite(v, cam.ctx.canvas, shell.engine, false));
    e.splat.mesh.visible = true;
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 40) n++; return n; };
    const dogPixels = diff(withDog.g.getImageData(0, 0, withDog.w, withDog.h).data, noDog.g.getImageData(0, 0, noDog.w, noDog.h).data);
    const k = withDog.w / innerWidth; // UI regions (back button, shutter, mic) must equal the video-only frame
    const uiDiff = [document.querySelector('.cam-btn.tl'), document.querySelector('.cam-shutter'), document.querySelector('.cam-btn.bl'), document.querySelector('.cam-btn.br')].map(el => {
      const b = (el as HTMLElement).getBoundingClientRect(), X = Math.round(b.left * k), Y = Math.round(b.top * k), W = Math.max(1, Math.round(b.width * k)), H = Math.max(1, Math.round(b.height * k));
      return diff(withDog.g.getImageData(X, Y, W, H).data, noDog.g.getImageData(X, Y, W, H).data);
    });
    add('capture', 'B.13-8 capture = camera frame + dog, no UI', dogPixels > 500 && uiDiff.every(n => n === 0),
      `${withDog.w}x${withDog.h} image, ${dogPixels} px differ with the dog in frame, ${uiDiff.reduce((a, b) => a + b, 0)} px differ under the 4 controls (must be 0). Share sheet / download not exercised`);

    // B13-9: Camera -> Room -> Camera x5: camera released, nothing leaks, pet state kept
    const stats0 = { ...e.stats };
    let leaks = 0, lightsLeft = 0;
    for (let i = 0; i < 5; i++) {
      await sh.switchTo('room'); await sleep(120);
      lightsLeft += tracks.filter(t => t.readyState === 'live').length;
      const p0 = pos();
      fire('pointerdown', innerWidth * 0.6, innerHeight * 0.85, 9); fire('pointerup', innerWidth * 0.6, innerHeight * 0.85, 9); await sleep(60);
      if (document.querySelectorAll('video, .cam-ui').length || cam.pts.size || cam.live) leaks++;
      void p0;
      await sh.switchTo('camera'); await until(() => cam.live, 4000);
      if (document.querySelectorAll('video').length !== 1 || document.querySelectorAll('.cam-ui').length !== 1) leaks++;
    }
    const dStats = Math.max(Math.abs(e.stats.energy - stats0.energy), Math.abs(e.stats.happiness - stats0.happiness), Math.abs(e.stats.hunger - stats0.hunger));
    add('switch', 'B.13-9 Camera <-> Room x5: camera released, no leaks, pet keeps its state', lightsLeft === 0 && leaks === 0 && dStats <= 2,
      `${tracks.length} camera tracks opened, ${lightsLeft} still live while in the Room, ${leaks} leaked layers/handlers, needs drifted ${dStats.toFixed(1)} points over the run`);

    // B13-10: fps at the low preset
    gyro(); cam.pose.recenter(); orient(0, 68); await sleep(500);
    let frames = 0; const prev = e.onFrame; e.onFrame = (t: number, f: unknown) => { frames++; prev?.(t, f); };
    const f0 = performance.now(); await sleep(3000); e.onFrame = prev;
    const fps = frames / ((performance.now() - f0) / 1000), gl = e.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    add('fps', 'B.13-10 30+ fps at the low preset on a mid-range phone', fps >= 30 ? null : false,
      `${fps.toFixed(0)} fps on THIS desktop (${dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 60) : 'unknown GPU'}), quality ${e.quality}, ${e.splat.count === undefined ? 'SDF plush dog (raymarched, no splats)' : e.splat.count + ' splats drawn'}, render scale ${e.pr}. Not a phone measurement`);

    // B13-11: WebXR cannot run here; check the non-XR projection path the XR change touched
    const size = e.renderer.getDrawingBufferSize(new THREE.Vector2()), fy = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2)), uf = e.splat.uniforms.uFocal?.value ?? new THREE.Vector2(fy, fy); // the SDF plush dog has no focal uniform: it uses the camera matrices directly
    const xrOk = Math.abs(uf.y - fy) < 0.5 && Math.abs(uf.x - fy) < 0.5 && !e.renderer.xr.isPresenting;
    add('webxr', 'B.13-11 WebXR: walking around the dog; falls back without a reload', xrOk ? null : false,
      `not runnable on desktop (needs an Android phone). Checked only that the non-XR focal length is unchanged by the XR code: ${uf.y.toFixed(1)} px vs ${fy.toFixed(1)} expected; True AR chip hidden here: ${(document.querySelector('.cam-chip:last-child') as HTMLElement)?.hidden}`);
  } catch (err) {
    add('harness', 'acceptance run crashed', false, String((err as Error)?.stack ?? err));
  } finally {
    clearInterval(painter);
    md.getUserMedia = realGum;
  }

  (window as Any).__acceptCamera = rows;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;max-height:70vh;overflow:auto;background:#fffe;color:#111;padding:8px;font:11px monospace;white-space:pre-wrap;z-index:99';
  pre.textContent = rows.map(r => `${r.pass === null ? 'DESKTOP-ONLY' : r.pass ? 'PASS' : 'FAIL'}  ${r.criterion}\n      ${r.detail}`).join('\n');
  document.body.appendChild(pre);
  return rows;
}
