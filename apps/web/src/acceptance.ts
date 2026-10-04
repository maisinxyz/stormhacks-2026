// PRD 1.10 acceptance run: open /?accept=1 (dev only). Results land in window.__accept and as a table on the page.
// Uses an in-page stub for B2's endpoints, so the real image-to-3D service is NOT exercised.
import * as THREE from 'three';
import type { PetBundle, Species } from '@fetch/contracts';
import type { Engine } from './engine';
import { decodeSplat, encodeSplat, type Gaussians } from './engine/pipeline/gaussians';
import { generatePet } from './engine/pipeline/generate';
import { PACKS } from './engine/species';
import { Skeleton } from './engine/skeleton';

type Row = { id: string; criterion: string; pass: boolean | null; detail: string };
type Any = any; // reaches into engine privates for measurement

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise<number>(r => requestAnimationFrame(r));

function plyFrom(g: Gaussians): ArrayBuffer {
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${g.n}\n${props.map(p => `property float ${p}`).join('\n')}\nend_header\n`;
  const hb = new TextEncoder().encode(head), body = new Float32Array(g.n * props.length);
  const SH = 0.28209479, logit = (a: number) => Math.log((a + 1e-4) / (1 - a + 1e-4));
  for (let i = 0; i < g.n; i++) {
    const o = i * props.length;
    body.set([g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]], o);
    body.set([0, 1, 2].map(k => (g.rgba[i * 4 + k] / 255 - 0.5) / SH), o + 3);
    body[o + 6] = logit(g.rgba[i * 4 + 3] / 255);
    body.set([0, 1, 2].map(k => Math.log(g.scale[i * 3 + k])), o + 7);
    body.set([g.rot[i * 4], g.rot[i * 4 + 1], g.rot[i * 4 + 2], g.rot[i * 4 + 3]], o + 10);
  }
  const out = new Uint8Array(hb.length + body.byteLength);
  out.set(hb); out.set(new Uint8Array(body.buffer), hb.length);
  return out.buffer;
}

async function doodle(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 260;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c8873c';
  x.beginPath(); x.ellipse(190, 110, 110, 55, 0, 0, Math.PI * 2); x.fill();          // body
  x.beginPath(); x.arc(320, 80, 40, 0, Math.PI * 2); x.fill();                        // head
  for (const lx of [110, 150, 230, 270]) x.fillRect(lx, 130, 22, 100);                // legs
  x.fillRect(65, 60, 50, 14);                                                          // tail
  return new Promise(r => c.toBlob(b => r(b!), 'image/png'));
}

/** Stand-in for B2: /uploads, /gen/*, /pets. `mode` picks the image-to-3d outcome. */
function stubB2(ply: ArrayBuffer, alpha: Blob, mode: 'ok' | 'fail') {
  const real = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('/stub')) return real(input, init);
    const path = url.slice('/stub'.length), json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
    if (path === '/uploads') return json({ imageId: 'img1' });
    if (path === '/gen/segment') return new Response(alpha);
    if (path === '/gen/image-to-3d') return json({ jobId: 'job1' });
    if (path.startsWith('/gen/jobs/')) return mode === 'ok' ? json({ status: 'done', splatUrl: URL.createObjectURL(new Blob([ply])) }) : json({ status: 'failed', error: 'gen_failed' });
    if (path === '/pets') {
      const f = init!.body as FormData, u = (k: string) => URL.createObjectURL(f.get(k) as Blob);
      const meta = JSON.parse(f.get('metadata') as string);
      return json({ id: 'p1', ...meta, splatUrl: u('splat'), rigUrl: u('rig'), weightsUrl: u('weights'), thumbnailUrl: u('thumbnail'),
        personality: { eager: 0.5, sassy: 0.5, anxious: 0.5, chatty: 0.5 }, stats: { energy: 100, happiness: 80, hunger: 0 }, createdAt: new Date().toISOString() });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return () => { window.fetch = real; };
}

// sqrt(max/min eigenvalue) of AtA: 1 = pure rotation (+uniform scale), larger = shear/stretch
function conditionNumber(a: number[]) {
  const m = [0, 1, 2].map(i => [0, 1, 2].map(j => a[0 * 3 + i] * a[0 * 3 + j] + a[1 * 3 + i] * a[1 * 3 + j] + a[2 * 3 + i] * a[2 * 3 + j]));
  const p1 = m[0][1] ** 2 + m[0][2] ** 2 + m[1][2] ** 2, q = (m[0][0] + m[1][1] + m[2][2]) / 3;
  if (p1 < 1e-12) { const d = [m[0][0], m[1][1], m[2][2]]; return Math.sqrt(Math.max(...d) / Math.max(1e-9, Math.min(...d))); }
  const p2 = (m[0][0] - q) ** 2 + (m[1][1] - q) ** 2 + (m[2][2] - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
  const B = m.map((r, i) => r.map((v, j) => (v - (i === j ? q : 0)) / p));
  const det = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
  const phi = Math.acos(Math.max(-1, Math.min(1, det / 2))) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return Math.sqrt(e1 / Math.max(1e-9, e3));
}

async function shear(species: Species, clips: string[]) {
  const dir = `/bundles/${species}/`;
  const rig = await (await fetch(dir + 'rig.json')).json();
  const w = new Uint8Array(await (await fetch(dir + 'weights.bin')).arrayBuffer());
  const n = w.length / 8, sk = new Skeleton(rig.bones), pack = PACKS[species];
  const sample = Array.from({ length: 4000 }, () => Math.floor(Math.random() * n));
  let worst = 0, worstClip = '';
  for (const cn of clips) {
    const c = pack.clips[cn];
    for (let f = 0; f < 12; f++) {
      const ph = f / 12, pose = c.fn(ph, ph * c.dur);
      sk.reset();
      for (const [b, e] of Object.entries(pose.bones)) sk.setEuler(b, e[0], e[1], e[2]);
      sk.update();
      const ratios = sample.map(i => {
        const A = new Array(9).fill(0);
        for (let k = 0; k < 4; k++) {
          const wt = w[i * 8 + 4 + k] / 255;
          if (!wt) continue;
          const e = sk.world[w[i * 8 + k]].elements;
          for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) A[r * 3 + cc] += wt * e[cc * 4 + r];
        }
        return conditionNumber(A);
      }).sort((x, y) => x - y);
      const p99 = ratios[Math.floor(ratios.length * 0.99)];
      if (p99 > worst) { worst = p99; worstClip = cn; }
    }
  }
  return { worst: +worst.toFixed(3), clip: worstClip };
}

export async function run(engine: Engine, bundle: PetBundle) {
  const e = engine as Any, rows: Row[] = [];
  const add = (id: string, criterion: string, pass: boolean | null, detail: string) => { rows.push({ id, criterion, pass, detail }); console.log(pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL', id, detail); };

  // 1. photo/drawing -> skinned splat (stubbed B2), solid path and sprite-rig fallback
  const alpha = await doodle(), ply = plyFrom(decodeSplat(await (await fetch(bundle.splatUrl)).arrayBuffer()));
  for (const mode of ['ok', 'fail'] as const) {
    const restore = stubB2(ply, alpha, mode);
    try {
      const t0 = performance.now(), stages: string[] = [];
      const b = await generatePet('/stub', { kind: 'photo', image: alpha, species: 'dog', name: 'Rex' }, p => { if (!stages.includes(p.stage)) stages.push(p.stage); });
      const secs = (performance.now() - t0) / 1000;
      await engine.loadPet(b);
      await sleep(600);
      const n = e.splat.total;
      add(`gen-${mode}`, mode === 'ok' ? '1.10-1 photo -> splat (3D path)' : '1.10-1 fallback to sprite rig', secs < 120 && n > 1000 && e.splat.mesh.visible, `${secs.toFixed(1)}s, ${n} splats, stages ${stages.join('>')} [B2 stubbed]`);
      // all 13 verbs still animate on the generated rig
      for (const v of Object.keys(PACKS.dog.verbs)) engine.previewVerb(v as never, 'neutral', 0.1);
      await sleep(300);
    } catch (err) { add(`gen-${mode}`, '1.10-1', false, String(err)); }
    restore();
  }
  await engine.loadPet(bundle);
  await sleep(500);

  // 2. shear proxy: 99th-percentile condition number of the blended skin matrix
  for (const [sp, clips] of [['dog', ['stand', 'walk', 'run']], ['bird', ['perch', 'hop', 'flapHop']]] as const) {
    const s = await shear(sp, [...clips]);
    add(`shear-${sp}`, '1.10-2 no visible shearing (idle/walk/run)', s.worst < 1.5, `p99 condition number ${s.worst} (worst clip ${s.clip}); proxy, not a visual check`);
  }

  // 3. fps at 300k: replicate the test dog 28x with jitter
  {
    const g = decodeSplat(await (await fetch(bundle.splatUrl)).arrayBuffer()), w = new Uint8Array(await (await fetch(bundle.weightsUrl)).arrayBuffer());
    const reps = Math.ceil(300_000 / g.n), big = new Uint8Array(g.n * reps * 32), bw = new Uint8Array(g.n * reps * 8), src = new Uint8Array(encodeSplat(g));
    for (let r = 0; r < reps; r++) {
      big.set(src, r * src.length); bw.set(w, r * w.length);
      const f = new Float32Array(big.buffer, r * src.length, g.n * 8);
      // denser cloud => smaller splats (same coverage as a real 300k capture; unscaled copies would be ~28x overdraw)
      for (let i = 0; i < g.n; i++) for (let k = 0; k < 3; k++) { f[i * 8 + k] += (Math.random() - 0.5) * 0.03; f[i * 8 + 3 + k] /= Math.cbrt(reps); }
    }
    const url = (d: Uint8Array) => URL.createObjectURL(new Blob([d as BlobPart]));
    await engine.loadPet({ ...bundle, splatUrl: url(big), weightsUrl: url(bw) });
    await sleep(1000);
    let frames = 0; const t0 = performance.now(), prev = engine.onFrame;
    engine.onFrame = t => { frames++; prev?.(t); };
    await sleep(3000);
    engine.onFrame = prev;
    const fps = frames / ((performance.now() - t0) / 1000), gl = e.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
    add('fps-300k', '1.10-2 >= 30 fps at 300k', /swiftshader|software|llvmpipe/i.test(gpu) ? null : fps >= 30,
      `${fps.toFixed(0)} fps, ${e.splat.total} splats (${e.splat.count} drawn, quality ${e.quality}, render scale ${e.pr}), last CPU sort ${e.splat.lastSortMs.toFixed(0)}ms, GPU: ${gpu}`);
    e.setQuality('high');
    await engine.loadPet(bundle);
    await sleep(500);
  }

  // 4. reaction latency (<300ms) for every local intent, reaction, feed, throw
  {
    const lat: Record<string, number> = {};
    const t = async (name: string, fn: () => void) => {
      engine.doIntent('dance'); await sleep(250);
      const before = e.beh.anim.clip, t0 = performance.now();
      fn();
      for (let i = 0; i < 40 && e.beh.anim.clip === before; i++) await frame();
      lat[name] = Math.round(performance.now() - t0);
      await sleep(120);
    };
    for (const i of ['sit', 'stay', 'come', 'speak', 'roll_over', 'spin', 'play_dead', 'shake', 'fetch_ball', 'sleep', 'wake', 'trick', 'hide', 'stop'] as const) await t(i, () => engine.doIntent(i));
    for (const k of ['pet', 'poke', 'feed'] as const) await t(`react:${k}`, () => engine.react(k));
    await t('throw', () => engine.spawnBall(-0.8, 0.6, 4, 3));
    const m = e.splat.mesh.position, v = new THREE.Vector3(m.x, m.y + 0.45, 0).project(e.camera);
    await t('feed(drop)', () => engine.dropFood('treat', ((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight));
    const worst = Math.max(...Object.values(lat));
    add('latency', '1.10-4 reacts within 300ms', worst < 300, `worst ${worst}ms; ${JSON.stringify(lat)}`);
    engine.doIntent('stop');
  }

  // 5. edge-peek mirrors tool events 1:1
  {
    await sleep(500);
    const before = e.peekLog.length;
    const steps = [{ id: 'a', verb: 'SEARCH', mood: 'focused', label: 'a' }, { id: 'b', verb: 'READ', mood: 'focused', label: 'b' }] as const;
    const evs: [Parameters<Engine['pushToolEvent']>[0], string][] = [
      [{ type: 'run.plan', steps: [...steps] }, 'plan'], [{ type: 'tool.start', stepId: 'a', tool: 't', label: 'l' }, 'start'],
      [{ type: 'tool.progress', stepId: 'a', note: 'n', itemsRead: 1 }, 'pile'], [{ type: 'tool.progress', stepId: 'a', note: 'n', itemsRead: 2 }, 'pile'],
      [{ type: 'tool.retry', stepId: 'a', attempt: 2 }, 'retry'], [{ type: 'tool.end', stepId: 'a', ok: true }, 'end-ok'],
      [{ type: 'tool.start', stepId: 'b', tool: 't', label: 'l' }, 'start'], [{ type: 'tool.end', stepId: 'b', ok: false }, 'end-fail'],
      [{ type: 'run.result', summary: 's', mood: 'proud' }, 'push'],
    ];
    for (const [ev] of evs) { engine.pushToolEvent(ev); await sleep(250); }
    const got = e.peekLog.slice(before), want = evs.map(x => x[1]);
    add('peek', '1.10-5 edge-peek reflects tool events 1:1', JSON.stringify(got) === JSON.stringify(want), `got ${got.join(',')}`);
    await sleep(2500);
  }

  // 6. pet-to-approve only while pending
  {
    engine.doIntent('stop'); await sleep(2000);
    let approves = 0;
    engine.on('APPROVE', () => approves++);
    const fire = (type: string, x: number, y: number) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
    const pos = () => { const m = e.splat.mesh.position, v = new THREE.Vector3(m.x, m.y + 0.45, 0).project(e.camera); return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight]; };
    const stroke = async () => { const [x, y] = pos(); fire('pointermove', x, y); fire('pointerdown', x, y); for (let i = 0; i < 50; i++) { fire('pointermove', x + (i % 2 ? 30 : -30), y); await sleep(30); } fire('pointerup', x, y); };
    engine.doIntent('stay'); await sleep(300);
    await stroke();
    const idle = approves;
    engine.pushToolEvent({ type: 'run.plan', steps: [{ id: 'z', verb: 'WRITE', mood: 'focused', label: 'z' }] }); await sleep(3500);
    engine.pushToolEvent({ type: 'approval.required', actionId: 'a1', kind: 'send_email', preview: { summary: 's' }, contentHash: 'h' });
    await sleep(3500);
    await stroke(); // card not visible yet (setApprovalPending not called): must do nothing
    const early = approves;
    engine.setApprovalPending(true);
    await stroke();
    add('approve', '1.10-6 pet-to-approve only while pending', idle === 0 && early === 0 && approves === 1, `no pending: ${idle}, card not visible: ${early}, pending: ${approves}`);
    engine.setApprovalPending(false);
  }

  // 7. all 13 verbs and bundles
  for (const sp of ['dog', 'bird'] as const) {
    const miss = Object.entries(PACKS[sp].verbs).filter(([, v]) => v.clips.some(c => !PACKS[sp].clips[c])).map(([k]) => k);
    add(`verbs-${sp}`, '1.10-3 all 13 verbs implemented', Object.keys(PACKS[sp].verbs).length === 13 && miss.length === 0, `13 verbs, missing clips: ${miss.join(',') || 'none'}`);
    const r = await fetch(`/bundles/${sp}/bundle.json`);
    add(`bundle-${sp}`, '1.10-7 pre-generated bundle in /public/bundles', r.ok, `${r.status} (procedural placeholder, swap in real image-to-3d output)`);
  }

  (window as Any).__accept = rows;
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;top:30px;left:8px;background:#fffd;padding:8px;font:11px monospace;max-width:70vw;white-space:pre-wrap;z-index:9';
  pre.textContent = rows.map(r => `${r.pass === null ? 'INFO' : r.pass ? 'PASS' : 'FAIL'}  ${r.criterion}\n      ${r.detail}`).join('\n');
  document.body.appendChild(pre);
  return rows;
}
