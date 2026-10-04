// PRD 1.2 orchestration. Heavy inference lives behind B2's endpoints (apps/server/README.md):
//   POST /uploads        multipart {image}                    -> { imageId }
//   POST /gen/reference  json {imageId, species, kind}        -> { imageId }  (drawing -> realistic; photo -> standing repose)
//   POST /gen/segment    multipart {image}                    -> image/png (alpha)
//   POST /gen/image-to-3d json {imageIds, species}            -> { jobId }
//   GET  /gen/jobs/:id                                        -> { status: 'pending'|'done'|'failed', splatUrl?, error?, retryAfter? }
//   POST /pets           multipart {splat, rig, weights, thumbnail, metadata(json)} -> PetBundle
// Errors are JSON {code, message, retryAfter?}. gen_quota (free GPU quota) is surfaced to the caller as a GenError;
// other 3D failures fall back to the 2.5D sprite rig and are reported through a 'fallback' progress event.
import type { PetBundle, Species } from '@fetch/contracts';
import { cleanupSplat, MAIN_BUDGET } from './cleanup';
import { encodeSplat, parsePly, type Gaussians } from './gaussians';
import { fitRig, skinWeights } from './rig';
import { knownBundle, knownDog } from '../sdf/known';
import { spriteToGaussians } from './spriteFallback';

/** `detail` is set on the 'fallback' stage: the GenError code that forced the flat sprite rig. */
export type Progress = (p: { stage: string; pct: number; detail?: string }) => void;
export interface GenInput { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string }

export class GenError extends Error {
  /** retryAfter: seconds until the free GPU quota resets (set with gen_quota). */
  constructor(public code: string, message = code, public retryAfter?: number) { super(message); this.name = 'GenError'; }
}

/** Build a GenError from a non-2xx response, keeping the server's {code, message, retryAfter} when present. */
async function errorFrom(r: Response): Promise<GenError> {
  const text = await r.text().catch(() => r.statusText);
  let body: { code?: string; message?: string; retryAfter?: number } = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const header = Number(r.headers.get('retry-after'));
  const retryAfter = typeof body.retryAfter === 'number' ? body.retryAfter : Number.isFinite(header) && header > 0 ? header : undefined;
  return new GenError(body.code ?? `http_${r.status}`, body.message ?? text, retryAfter);
}

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw await errorFrom(r);
  return r.json() as Promise<T>;
};

const form = (o: Record<string, Blob | string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};

const isQuota = (err: unknown): err is GenError => err instanceof GenError && err.code === 'gen_quota';

export async function generatePet(api: string, input: GenInput, onProgress: Progress, budget = MAIN_BUDGET): Promise<PetBundle> {
  const p = (stage: string, pct: number, detail?: string) => onProgress(detail ? { stage, pct, detail } : { stage, pct });
  const post = (path: string, body: BodyInit, headers?: HeadersInit) => fetch(api + path, { method: 'POST', body, headers, credentials: 'include' });
  const postJson = (path: string, body: unknown) => post(path, JSON.stringify(body), { 'content-type': 'application/json' });

  // A photo we already modelled by hand: return that dog at once, no server or GPU quota.
  // ponytail: the bundle lives in this browser session only (not POSTed to /pets); save it server-side if it must survive a reload.
  const known = await knownDog(input.image);
  if (known) { p('save', 1); return knownBundle(known, input.name || known.name); }

  p('upload', 0.02);
  const uploaded = (await json<{ imageId: string }>(await post('/uploads', form({ image: input.image })))).imageId;

  // Drawing -> realistic reference (required). Photo -> standing full-body repose for the rig (best effort:
  // any failure except gen_quota keeps the original photo, e.g. a server that doesn't support kind yet).
  let imageId = uploaded;
  p(input.kind === 'drawing' ? 'cleanup' : 'pose', 0.08);
  try {
    imageId = (await json<{ imageId: string }>(await postJson('/gen/reference', { imageId: uploaded, species: input.species, kind: input.kind, ...(plushStyle() ? { style: 'plush' } : {}) }))).imageId;
  } catch (err) {
    if (input.kind === 'drawing' || isQuota(err)) throw err;
    console.warn('photo repose failed, using the original photo:', err);
  }

  // ponytail: no in-browser SAM yet; always use B2's /gen/segment. Add an ONNX segmenter first in line when F1 has time.
  p('segment', 0.15);
  const seg = await post('/gen/segment', form({ image: input.image }));
  if (!seg.ok) throw await errorFrom(seg);
  const alpha = await seg.blob();

  // 3D path; gen_quota is surfaced. Any other gen_* failure, low quality, or unreadable output falls back to the
  // 2.5D sprite rig (same template + clips) and reports it via the 'fallback' stage.
  const solid = async (): Promise<Gaussians> => {
    p('3d', 0.2);
    const { jobId } = await json<{ jobId: string }>(await postJson('/gen/image-to-3d', { imageIds: [imageId], species: input.species }));
    let splatUrl = '';
    for (let t = 0; t < 180; t++) { // ~3 min cap
      const j = await json<{ status: string; splatUrl?: string; error?: string; retryAfter?: number }>(await fetch(`${api}/gen/jobs/${jobId}`, { credentials: 'include' }));
      if (j.status === 'done' && j.splatUrl) { splatUrl = j.splatUrl; break; }
      if (j.status === 'failed') throw new GenError(j.error ?? 'gen_failed', j.error ?? 'gen_failed', j.retryAfter);
      p('3d', 0.2 + 0.5 * Math.min(1, t / 90));
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!splatUrl) throw new GenError('gen_timeout');
    p('rig', 0.72);
    const raw = parsePly(await (await fetch(splatUrl)).arrayBuffer());
    const g = cleanupSplat(raw, { species: input.species, budget, source: 'trellis' });
    if (g.n < 2000 || g.n < raw.n * 0.2) throw new GenError('gen_low_quality');
    return g;
  };
  let g: Gaussians;
  try { g = await solid(); } catch (err) {
    if (isQuota(err)) throw err;
    console.warn('image-to-3d failed, using sprite rig:', err);
    p('fallback', 0.72, err instanceof GenError ? err.code : 'gen_failed');
    g = await spriteToGaussians(alpha, input.species, budget);
  }
  const rig = fitRig(g, input.species);
  const weights = skinWeights(g, rig);

  p('save', 0.9);
  const meta = { name: input.name, species: input.species };
  const res = await post('/pets', form({
    splat: new Blob([encodeSplat(g)]), rig: new Blob([JSON.stringify(rig)], { type: 'application/json' }),
    weights: new Blob([weights as BlobPart]), thumbnail: alpha, metadata: JSON.stringify(meta),
  }));
  const bundle = await json<PetBundle>(res);
  p('save', 1);
  return bundle;
}

/** `?style=plush` on the page asks the server for the plush-toy reference instead of the photoreal one (opt-in; default unchanged). */
function plushStyle() { try { return new URLSearchParams(location.search).get('style') === 'plush'; } catch { return false; } }
