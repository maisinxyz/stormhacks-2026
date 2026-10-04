// PRD 1.2 orchestration. Heavy inference lives behind B2's endpoints.
// ASSUMED B2 request/response shapes (PRD lists only paths); confirm with B2:
//   POST /uploads        multipart {image}                    -> { imageId }
//   POST /gen/reference  json {imageId, species}              -> { imageId }          (drawings only)
//   POST /gen/segment    multipart {image}                    -> image/png (alpha)    (fallback when no in-browser segmenter)
//   POST /gen/image-to-3d json {imageIds, species}            -> { jobId }
//   GET  /gen/jobs/:id                                        -> { status: 'pending'|'done'|'failed', splatUrl?, error?: 'gen_timeout'|'gen_low_quality'|'gen_failed' }
//   POST /pets           multipart {splat, rig, weights, thumbnail, metadata(json)} -> PetBundle
import type { PetBundle, Species } from '@fetch/contracts';
import { cleanupSplat, MAIN_BUDGET } from './cleanup';
import { encodeSplat, parsePly } from './gaussians';
import { fitRig, skinWeights } from './rig';

export type Progress = (p: { stage: string; pct: number }) => void;
export interface GenInput { kind: 'photo' | 'drawing'; image: Blob; species: Species; name: string }

export class GenError extends Error {
  constructor(public code: string, message = code) { super(message); }
}

const json = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new GenError(`http_${r.status}`, await r.text().catch(() => r.statusText));
  return r.json() as Promise<T>;
};

const form = (o: Record<string, Blob | string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};

export async function generatePet(api: string, input: GenInput, onProgress: Progress, budget = MAIN_BUDGET): Promise<PetBundle> {
  const p = (stage: string, pct: number) => onProgress({ stage, pct });
  const post = (path: string, body: BodyInit, headers?: HeadersInit) => fetch(api + path, { method: 'POST', body, headers, credentials: 'include' });

  p('upload', 0.02);
  let { imageId } = await json<{ imageId: string }>(await post('/uploads', form({ image: input.image })));

  if (input.kind === 'drawing') {
    p('cleanup', 0.08); // "cleanup" stage name = drawing -> clean reference render
    imageId = (await json<{ imageId: string }>(await post('/gen/reference', JSON.stringify({ imageId, species: input.species }), { 'content-type': 'application/json' }))).imageId;
  }

  // ponytail: no in-browser SAM yet; always use B2's /gen/segment. Add an ONNX segmenter first in line when F1 has time.
  p('segment', 0.15);
  const alpha = await (await post('/gen/segment', form({ image: input.image }))).blob();

  p('3d', 0.2);
  const { jobId } = await json<{ jobId: string }>(await post('/gen/image-to-3d', JSON.stringify({ imageIds: [imageId], species: input.species }), { 'content-type': 'application/json' }));
  let splatUrl = '';
  for (let t = 0; t < 180; t++) { // ~3 min cap
    const j = await json<{ status: string; splatUrl?: string; error?: string }>(await fetch(`${api}/gen/jobs/${jobId}`, { credentials: 'include' }));
    if (j.status === 'done' && j.splatUrl) { splatUrl = j.splatUrl; break; }
    if (j.status === 'failed') throw new GenError(j.error ?? 'gen_failed');
    p('3d', 0.2 + 0.5 * Math.min(1, t / 90));
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!splatUrl) throw new GenError('gen_timeout');

  p('rig', 0.72);
  const raw = parsePly(await (await fetch(splatUrl)).arrayBuffer());
  const g = cleanupSplat(raw, { species: input.species, budget });
  if (g.n < 2000 || g.n < raw.n * 0.2) throw new GenError('gen_low_quality'); // F1 caller falls back to the sprite rig (not built yet)
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
