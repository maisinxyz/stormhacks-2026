// Desktop overlay page (apps/overlay hosts it in a transparent, click-through, always-on-top window).
// One Engine on a full-window transparent canvas; the pet walks along the bottom edge of the screen.
import * as THREE from 'three';
import type { LocalIntent, PetBundle } from '@fetch/contracts';
import { Engine } from '../engine';
import { AgentClient } from './agent';
import { api, bridge } from './bridge';

const PET_WORLD_H = 1.0;   // rig height of a standing dog/cat is ~0.9 world units (+ ears/fur)
const FLOOR_MARGIN_PX = 6; // gap between the pet's feet and the bottom of the window (the taskbar edge)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('pet'), bubble = $('bubble'), menu = $('menu'), task = $<HTMLFormElement>('task'), taskInput = $<HTMLInputElement>('task-input');

const engine = new Engine();
let bundle: PetBundle | undefined, petId: string | undefined;

// ---- stage: frame the camera so world y=0 (the floor) is the bottom of the window ----
// The engine's desk view walks the pet on the z=0 plane in world units and derives its roaming bounds from the
// camera (Behavior bounds = canvas left/right edge projected onto z=0), so moving the camera is all it takes to
// get a small pet that roams the full screen width at the bottom. No engine change needed.
function frameStage() {
  const cam = engine.camera, W = innerWidth, H = innerHeight;
  const petPx = Math.min(190, Math.max(110, H * 0.15));
  const viewH = (PET_WORLD_H * H) / petPx;                      // world units visible top-to-bottom at z=0
  const dist = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const cy = viewH / 2 - (FLOOR_MARGIN_PX * viewH) / H;        // so y=0 lands FLOOR_MARGIN_PX above the bottom
  cam.aspect = W / H;
  cam.position.set(0, cy, dist);
  cam.lookAt(0, cy, 0);                                         // level camera: screen x maps linearly to world x
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  // F2 platform contract: the screen bottom is the pet's edge platform (the engine treats 'edge' as the ground line).
  engine.setPlatforms([{ id: 'screen-bottom', x: 0, y: H - FLOOR_MARGIN_PX, w: W, h: FLOOR_MARGIN_PX, kind: 'edge' }]);
}

/** Pet's anchor in screen px: centre-x, top of head (y) and feet (feetY). */
function petScreen() {
  const p = engine.petPosition, s = engine.scaleNow;
  const top = new THREE.Vector3(p.x, p.y + PET_WORLD_H * s, p.z).project(engine.camera);
  const feet = new THREE.Vector3(p.x, p.y, p.z).project(engine.camera);
  const x = (top.x + 1) / 2 * innerWidth;
  return { x: Math.min(innerWidth - 20, Math.max(20, x)), y: (1 - top.y) / 2 * innerHeight, feetY: (1 - feet.y) / 2 * innerHeight };
}

/** Place a fixed element centred above (or left/right-clamped near) the pet. */
function placeNear(n: HTMLElement, gap = 12, centered = false) {
  const a = petScreen(), w = n.offsetWidth, h = n.offsetHeight;
  if (centered) { n.style.left = `${a.x}px`; n.style.top = `${a.y - gap}px`; return; } // CSS translate(-50%,-100%)
  const x = Math.min(innerWidth - w - 8, Math.max(8, a.x - w / 2));
  const y = Math.min(innerHeight - h - 8, Math.max(8, a.y - h - gap));
  n.style.left = `${x}px`; n.style.top = `${y}px`;
}

// ---- speech bubble ----
let bubbleUntil = 0;
function say(text: string, secs = 3.5) {
  bubble.textContent = text;
  bubble.hidden = false;
  bubbleUntil = performance.now() + secs * 1000;
}

const agent = new AgentClient(engine, () => petId, say);

// ---- click-through: interactive only over the pet or our own UI ----
const mouse = { x: -1, y: -1, down: false, lastUi: 0 };
const overUi = (x: number, y: number) => !!(document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.ui');
function updateInteractive() {
  if (mouse.x < 0) return;
  const ui = overUi(mouse.x, mouse.y);
  if (ui) mouse.lastUi = performance.now();
  bridge.setInteractive(mouse.down || ui || engine.hitTest(mouse.x, mouse.y));
}
let lastCheck = 0;
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  const now = performance.now();
  if (now - lastCheck > 40) { lastCheck = now; updateInteractive(); } // forward:true delivers moves while click-through
});
window.addEventListener('pointerdown', e => { if (e.button === 0) mouse.down = engine.hitTest(e.clientX, e.clientY) || overUi(e.clientX, e.clientY); }, true);
window.addEventListener('pointerup', () => {
  if (!mouse.down) return;
  mouse.down = false;
  updateInteractive();
});

/** Keep the pet on the screen-bottom line (z=0). The engine's 1.8 drag/point use the pointer's world height as depth in
 *  desk view, which here would walk the pet toward the camera (giant pet below the screen edge). */
function pinToFloorLine() {
  const s = engine.getPetState();
  if (Math.abs(s.z) < 1e-3) return;
  engine.applyPetState({ ...s, z: 0 });
  if (!mouse.down) engine.placePet(s.x, 0, true); // replace any walk that still targets z != 0
}

// ---- gestures: click = poke and stroke = pet come from the engine's own Interactions; double-click = trick ----
window.addEventListener('dblclick', e => { if (engine.hitTest(e.clientX, e.clientY)) intent('trick'); });
window.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (engine.hitTest(e.clientX, e.clientY)) openMenu();
});

const intent = (i: LocalIntent) => engine.doIntent(i);

// ---- right-click menu ----
let follow = 0; // "Come here": follow the cursor until this time
const ITEMS: [string, () => void][] = [
  ['🪑 Sit', () => intent('sit')],
  ['💤 Sleep', () => intent('sleep')],
  ['☀️ Wake up', () => intent('wake')],
  ['🔄 Roll over', () => intent('roll_over')],
  ['🌀 Spin', () => intent('spin')],
  ['💀 Play dead', () => intent('play_dead')],
  ['💃 Dance', () => intent('dance')],
  ['🎾 Fetch ball', () => intent('fetch_ball')],
  ['👋 Come here', () => { follow = performance.now() + 6000; engine.pointAt(mouse.x, mouse.y); }],
  ['🦴 Treat', () => { if (!engine.feed()) say('Not hungry for that.'); }],
];
function openMenu() {
  closeTask();
  menu.replaceChildren(...ITEMS.map(([label, fn]) => Object.assign(document.createElement('button'), {
    type: 'button', textContent: label, role: 'menuitem', onclick: () => { closeMenu(); fn(); },
  })), Object.assign(document.createElement('button'), { type: 'button', className: 'wide', textContent: '✨ Give me a task...', onclick: () => { closeMenu(); openTask(); } }));
  menu.hidden = false;
  placeNear(menu);
  mouse.lastUi = performance.now();
}
function closeMenu() { menu.hidden = true; }

// ---- task box ----
function openTask() {
  task.hidden = false;
  placeNear(task);
  bridge.setInteractive(true, true); // take keyboard focus so the user can type
  taskInput.value = '';
  setTimeout(() => taskInput.focus(), 30);
}
function closeTask() {
  if (task.hidden) return;
  task.hidden = true;
  taskInput.blur();
  bridge.setInteractive(false, false); // hand keyboard focus back
  updateInteractive();
}
task.addEventListener('submit', e => { e.preventDefault(); const t = taskInput.value; closeTask(); void agent.start(t); });
taskInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeTask(); });
window.addEventListener('blur', () => { if (!taskInput.value) closeTask(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
  if (agent.approvalOpen && e.target === document.body && e.key === 'Enter') void agent.approve();
});

// ---- per-frame: keep UI attached to the pet, idle roaming, follow, auto-close stray menus ----
let nextWander = performance.now() + 8000, lastFollow = 0;
engine.onFrame = () => {
  const now = performance.now();
  pinToFloorLine();
  if (!bubble.hidden) { if (now > bubbleUntil) bubble.hidden = true; else placeNear(bubble, 10, true); }
  if (!menu.hidden && now - mouse.lastUi > 2500 && !mouse.down) closeMenu(); // the click that would dismiss it went to another app
  for (const n of [task, $('approval')]) if (!n.hidden) placeNear(n, 14);
  if (now - lastCheck > 120) { lastCheck = now; updateInteractive(); } // the pet moves under a still cursor
  if (now < follow && now - lastFollow > 600 && mouse.x >= 0) { lastFollow = now; engine.pointAt(mouse.x, innerHeight - FLOOR_MARGIN_PX); }
  // Desk-view work mode mostly idles in place; on a desktop we want it to wander the whole bottom edge now and then.
  if (now > nextWander) {
    nextWander = now + 9000 + Math.random() * 12000;
    const s = engine.state, quiet = menu.hidden && task.hidden && !agent.running && now > follow;
    if (quiet && (s === 'idle' || s === 'play')) {
      const l = engine.groundPoint(80, innerHeight / 2), r = engine.groundPoint(innerWidth - 80, innerHeight / 2);
      if (l && r) engine.placePet(l.x + Math.random() * (r.x - l.x), 0, true);
    }
  }
};

// ---- load the pet: /session -> activePetId -> /pets/:id, else the bundled demo dog ----
async function loadBundle(): Promise<PetBundle> {
  const q = new URLSearchParams(location.search).get('pet');
  try {
    const session = await api<{ activePetId?: string | null }>('/session', { signal: AbortSignal.timeout(3000) });
    const id = q ?? session.activePetId;
    if (id) {
      const b = await api<PetBundle>(`/pets/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(5000) });
      petId = b.id;
      return b;
    }
  } catch (e) { console.warn('[overlay] server pet unavailable, using demo dog:', (e as Error).message); }
  const demo: PetBundle = await fetch('/bundles/dog/bundle.json').then(r => r.json());
  petId ??= demo.id; // the server answers with a friendly error if it doesn't know the demo pet
  return demo;
}

async function boot() {
  engine.mount(canvas, $<HTMLCanvasElement>('peek'));
  frameStage();
  window.addEventListener('resize', frameStage);
  bundle = await loadBundle();
  await engine.loadPet(bundle);
  frameStage(); // re-sync toy bounds once physics is up
  engine.on('POKE', () => { if (Math.random() < 0.25) say(bundle?.species === 'cat' ? 'Mrrp?' : 'Boop!', 1.5); });
  engine.on('FEED', () => say('Yum!', 1.5));
  say(`Hi, I'm ${bundle.name}! Right-click me.`, 4);
}

// Debug/automation hooks (used by apps/overlay OVERLAY_CAPTURE).
(window as unknown as Record<string, unknown>).__overlay = {
  engine, say, intent, openMenuAtPet: () => openMenu(), openTask,
  debug: () => ({ snap: engine.getPetState(), mesh: engine.petPosition.toArray(), cam: engine.camera.position.toArray(), fov: engine.camera.fov, loaded: !!bundle, species: bundle?.species, name: bundle?.name, petId, state: engine.state, pet: petScreen(), size: [innerWidth, innerHeight] }),
};

boot().catch(e => { console.error('[overlay] boot failed', e); say('I could not load my pet :(', 8); });
