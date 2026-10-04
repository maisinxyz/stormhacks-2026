import type { PetBundle } from '@fetch/contracts';
import { Engine } from './engine';

const species = new URLSearchParams(location.search).get('pet') === 'bird' ? 'bird' : 'dog';
const engine = new Engine();
const fps = document.getElementById('fps')!;
let last = 0, frames = 0, acc = 0;

engine.onFrame = t => {
  frames++; acc += t - last; last = t;
  if (acc > 1) { fps.textContent = `${(frames / acc).toFixed(0)} fps`; frames = 0; acc = 0; }
  const s = Math.sin(t * 3);
  engine.setBoneEuler('tail', 0, s * 0.6, 0);
  engine.setBoneEuler('head', Math.sin(t * 1.5) * 0.25, Math.sin(t) * 0.3, 0);
  engine.setBoneEuler('wingL', 0, 0, s * 0.6);
  engine.setBoneEuler('wingR', 0, 0, -s * 0.6);
  engine.setBoneEuler('legFL', s * 0.5, 0, 0);
  engine.setBoneEuler('legBR', s * 0.5, 0, 0);
  engine.setBoneEuler('legFR', -s * 0.5, 0, 0);
  engine.setBoneEuler('legBL', -s * 0.5, 0, 0);
};

engine.mount(document.getElementById('pet') as HTMLCanvasElement, document.getElementById('peek') as HTMLCanvasElement);
const bundle: PetBundle = await fetch(`/bundles/${species}/bundle.json`).then(r => r.json());
await engine.loadPet(bundle);

(window as unknown as { engine: Engine }).engine = engine;
