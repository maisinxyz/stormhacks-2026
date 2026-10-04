// First-person room self-check: /camera.html?accept=room. Results land in window.__acceptRoom (and the console).
// Short by design (about 40 s): every wait is bounded. It drives the room through its own entry points, not the mouse,
// so pointer lock, the real microphone and phone touch input are NOT covered here.
import type { PlayShell } from '../shell';
import { ROOM_SPEC } from '../scene';

interface Row { id: string; pass: boolean; detail: string }
type Any = any; // reaches into privates for measurement

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms: number) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await sleep(50); return f(); };

export async function run(shell: PlayShell) {
  const e = shell.engine as Any, room = (shell as Any).views.get('room') as Any, fps = room.fps as Any, rows: Row[] = [];
  const add = (id: string, pass: boolean, detail: string) => { rows.push({ id, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', id, detail); };
  const key = (type: 'keydown' | 'keyup', code: string) => window.dispatchEvent(new KeyboardEvent(type, { code }));
  const pet = () => e.petPosition, gap = () => Math.hypot(pet().x - fps.position.x, pet().z - fps.position.z);
  const aimAt = (x: number, y: number, z: number) => { const f = fps.position, dx = x - f.x, dy = y - f.y, dz = z - f.z; fps.yaw = Math.atan2(-dx, -dz); fps.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  const aimPet = () => aimAt(pet().x, 0.45 * e.scaleNow, pet().z);
  const click = () => { room.primary(true); room.primary(false); };
  const home = () => { fps.position.set(ROOM_SPEC.start.x, fps.position.y, ROOM_SPEC.start.z); fps.yaw = 0; fps.pitch = 0; };
  await sleep(1200);

  // walking: forward moves, the sofa and the walls stop the player
  const z0 = fps.position.z; key('keydown', 'KeyW'); await sleep(500); key('keyup', 'KeyW');
  const walked = z0 - fps.position.z;
  const S = ROOM_SPEC.sofa; fps.position.set(S.x + 1.2, fps.position.y, S.z); fps.yaw = Math.PI / 2; // face -x, toward the sofa
  key('keydown', 'KeyW'); await sleep(1300); key('keyup', 'KeyW');
  const stopX = fps.position.x, sofaEdge = S.x + S.depth / 2;
  fps.yaw = -Math.PI / 2; key('keydown', 'ShiftLeft'); key('keydown', 'KeyW'); await sleep(2600); key('keyup', 'KeyW'); key('keyup', 'ShiftLeft');
  const wallX = fps.position.x;
  add('walk', walked > 0.6 && stopX > sofaEdge + 0.2 && wallX < ROOM_SPEC.room.width / 2 - 0.2,
    `walked ${walked.toFixed(2)} m in 0.5 s; stopped ${(stopX - sofaEdge).toFixed(2)} m from the sofa; stopped at x ${wallX.toFixed(2)} by the wall (room half width ${ROOM_SPEC.room.width / 2})`);
  home();

  // hotbar
  key('keydown', 'Digit3'); const slot = document.querySelector<HTMLElement>('[data-item][aria-pressed="true"]')?.dataset.item;
  add('hotbar', slot === 'frisbee' && room.item === 'frisbee', `key 3 selected ${slot}`);

  // throw + fetch, for both toys
  for (const [code, kind] of [['Digit2', 'ball'], ['Digit3', 'frisbee']] as const) {
    home(); key('keydown', code);
    const n0 = room.fetches;
    room.primary(true); await sleep(600); room.primary(false);
    await sleep(150); const flew = room.toys.state.phase === 'flying';
    const back = await until(() => room.fetches > n0, 14000);
    const p = room.toys.state.position, inRoom = Math.abs(p.x) < 5.5 && Math.abs(p.z) < 4;
    add(`fetch-${kind}`, flew && back && inRoom && gap() < 1.9, `flew ${flew}, brought back ${back}, pet ${gap().toFixed(2)} m from the player, toy inside the room ${inRoom}`);
    await until(() => room.toys.state.phase === 'held', 2000);
  }

  // feeding: out of range does nothing to hunger, in range resets it
  e.applyPetState({ x: 0, z: -2.5 }); e.stats.hunger = 50; home(); key('keydown', 'Digit4');
  await sleep(100); aimPet(); click();
  const farHunger = e.stats.hunger;
  const came = await until(() => gap() < 2, 6000); aimPet(); await sleep(100); click();
  add('feed', farHunger > 40 && came && e.stats.hunger < 1, `too far: hunger stayed ${farHunger.toFixed(0)}; pet came over ${came}; fed up close: hunger ${e.stats.hunger.toFixed(0)}`);

  // stroke with an empty hand
  key('keydown', 'Digit1'); await sleep(1500); e.stats.happiness = 50; aimPet(); await sleep(60); click();
  add('stroke', e.stats.happiness > 53, `happiness 50 -> ${e.stats.happiness.toFixed(1)}`);

  // voice commands through the same matcher (typed, not spoken)
  const clip = () => Object.keys(e.pack.clips).find(k => e.pack.clips[k] === e.beh.anim.clip);
  await sleep(600); room.say('sot dawn'); await sleep(900); const sat = clip() === 'sit';
  e.applyPetState({ x: 0, z: -2.5 }); home(); room.say('come here'); const cameV = await until(() => gap() < 1.6, 6000);
  room.say('follow me'); const fol = room.following; room.say('banana xylophone'); await sleep(300);
  add('voice', sat && cameV && fol && !room.following && clip() === 'wag', `"sot dawn" -> sit ${sat}; "come here" -> ${gap().toFixed(2)} m; "follow me" -> following ${fol}; nonsense -> ${clip()} and following off`);

  // hoop and tunnel: the pet ends up on the far side
  for (const what of ['hoop', 'tunnel'] as const) {
    const P = ROOM_SPEC[what]; e.applyPetState({ x: P.x - 2, z: P.z + (what === 'hoop' ? 0.2 : -0.2) }); home(); key('keydown', 'Digit1'); await sleep(300);
    aimAt(P.x, what === 'hoop' ? ROOM_SPEC.hoop.y : ROOM_SPEC.tunnel.radius, P.z); await sleep(60);
    const aim = room.aim(), t0 = room.tricks; click();
    let through = false; // passed the middle of it, on its line
    const done = await until(() => { if (Math.abs(pet().x - P.x) < 0.25 && Math.abs(pet().z - P.z) < 0.2) through = true; return room.tricks > t0; }, 9000);
    add(what, aim === what && through && done && pet().x > P.x, `aimed at ${aim}; passed through the middle ${through}; ended at x ${pet().x.toFixed(2)} (far side is > ${P.x})`);
  }

  (window as Any).__acceptRoom = rows;
  console.log(`room: ${rows.filter(r => r.pass).length}/${rows.length} passed`);
}
