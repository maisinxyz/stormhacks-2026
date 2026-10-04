import type { PetBundle } from '@fetch/contracts';
import { Engine } from './engine';
import { cleanupSplat } from './engine/pipeline/cleanup';
import { decodeSplat, encodeSplat } from './engine/pipeline/gaussians';
import { fitRig, skinWeights } from './engine/pipeline/rig';

async function boot() {
const species = new URLSearchParams(location.search).get('pet') === 'bird' ? 'bird' : 'dog';
const engine = new Engine();
const fps = document.getElementById('fps')!;
let last = 0, frames = 0, acc = 0;

engine.onFrame = t => {
  frames++; acc += t - last; last = t;
  if (acc > 1) { const st = engine.stats; fps.textContent = `${(frames / acc).toFixed(0)} fps | ${engine.state}` + (st ? ` | E${st.energy.toFixed(0)} H${st.happiness.toFixed(0)} U${st.hunger.toFixed(0)}` : ''); frames = 0; acc = 0; }
};

engine.mount(document.getElementById('pet') as HTMLCanvasElement, document.getElementById('peek') as HTMLCanvasElement);
const bundle: PetBundle = await fetch(`/bundles/${species}/bundle.json`).then(r => r.json());
if (new URLSearchParams(location.search).has('pipeline')) {
  // Dev check: run the dog/bird test splat back through cleanup -> rig fit -> skin weights, then render that.
  const raw = decodeSplat(await fetch(bundle.splatUrl).then(r => r.arrayBuffer()));
  const g = cleanupSplat(raw, { species, budget: 300_000 });
  const rig = fitRig(g, species);
  const u = (d: BlobPart, t = 'application/octet-stream') => URL.createObjectURL(new Blob([d], { type: t }));
  console.log('pipeline', raw.n, '->', g.n);
  Object.assign(bundle, { splatUrl: u(encodeSplat(g)), rigUrl: u(JSON.stringify(rig), 'application/json'), weightsUrl: u(skinWeights(g, rig) as BlobPart) });
}
await engine.loadPet(bundle);

(window as unknown as { engine: Engine }).engine = engine;

// ---- dev controls: exercise intents, verbs, a fake errand, approval, modes ----
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;display:flex;flex-wrap:wrap;gap:4px;font:12px monospace';
document.body.appendChild(bar);
const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; bar.appendChild(b); };
const intents = ['sit', 'stay', 'come', 'speak', 'roll_over', 'spin', 'play_dead', 'shake', 'fetch_ball', 'sleep', 'wake', 'trick', 'dance', 'hide', 'stop'] as const;
intents.forEach(i => btn(i, () => engine.doIntent(i)));
const verbs = ['SEARCH', 'FETCH', 'READ', 'WRITE', 'COMPARE', 'ORGANIZE', 'SEND', 'WAIT', 'MONITOR', 'CALCULATE', 'NEGOTIATE', 'SUCCEED', 'FAIL'] as const;
verbs.forEach(v => btn(v, () => engine.previewVerb(v, 'neutral', 3, { kind: 'preset', name: 'document' })));
btn('MODE work', () => engine.setMode('work')); btn('MODE play', () => engine.setMode('play'));
btn('listen on', () => engine.setListening(true)); btn('listen off', () => engine.setListening(false));
btn('pet', () => engine.react('pet')); btn('poke', () => engine.react('poke'));
const step = (id: string, verb: (typeof verbs)[number]) => ({ id, verb, mood: 'focused' as const, label: id });
btn('RUN errand', () => {
  const steps = [step('s1', 'SEARCH'), step('s2', 'FETCH')];
  engine.pushToolEvent({ type: 'run.started', runId: 'r1' });
  engine.pushToolEvent({ type: 'run.plan', steps });
  setTimeout(() => engine.pushToolEvent({ type: 'tool.start', stepId: 's1', tool: 'drive.search', label: 'Searching' }), 1500);
  setTimeout(() => engine.pushToolEvent({ type: 'tool.end', stepId: 's1', ok: true }), 3500);
  setTimeout(() => engine.pushToolEvent({ type: 'run.result', summary: 'found it', mood: 'proud', prop: { kind: 'preset', name: 'document' } }), 5000);
});
btn('RUN -> approval', () => {
  engine.pushToolEvent({ type: 'run.plan', steps: [step('s1', 'WRITE')] });
  setTimeout(() => { engine.pushToolEvent({ type: 'approval.required', actionId: 'a', kind: 'send_email', preview: { summary: 'x' }, contentHash: 'h' }); engine.setApprovalPending(true); }, 3000);
});
btn('approve', () => engine.setApprovalPending(false));
btn('RUN error', () => {
  engine.pushToolEvent({ type: 'run.plan', steps: [step('s1', 'SEARCH')] });
  setTimeout(() => engine.pushToolEvent({ type: 'run.error', code: 'x', message: 'x', mood: 'sheepish' }), 3000);
});
engine.setPlatforms([{ id: 'win1', x: innerWidth * 0.55, y: innerHeight * 0.45, w: 260, h: 180, kind: 'window' }]);
engine.on('PET_AT_PLATFORM', e => console.log('perched', e.platformId));
engine.on('RETURNED', e => console.log('returned', e.runId));
engine.on('ANIM_DONE', e => console.log('anim done', e.id));

btn('ball', () => engine.spawnBall(-1, 1.2));
btn('feed treat', () => console.log('fed', engine.feedItem('treat'))); btn('feed seed', () => console.log('fed', engine.feedItem('seed')));
engine.on('PET_STROKE', e => console.log('stroke', e.intensity.toFixed(2)));
engine.on('POKE', () => console.log('poke')); engine.on('THROW', e => console.log('throw', e.vx.toFixed(1), e.vy.toFixed(1)));
engine.on('POINT', e => console.log('point', e.x.toFixed(2))); engine.on('APPROVE', e => console.log('APPROVE', e.actionId));
engine.onStats(s => console.log('stats', JSON.stringify(s)));

if (new URLSearchParams(location.search).has('accept')) import('./acceptance').then(m => m.run(engine, bundle)); // PRD 1.10 acceptance run
}
void boot();
