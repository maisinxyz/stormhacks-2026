import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { ApiError } from '../errors.js';
import type { AssetStore } from './storage.js';
import { Providers } from './providers.js';
import { mockAudio, mockPly, mockSticker } from './mock.js';
import { defaults, type Species, type PetBundle } from './types.js';

interface Job { id: string; user_id: string; species: Species; image_ids: string; status: string; asset_id: string | null; error: string | null; prediction_id: string | null; created_at: number }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
export async function imagePng(bytes: Buffer) {
  try {
    const img = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
    const info = await img.metadata();
    if (!['png', 'jpeg', 'webp'].includes(info.format ?? '') || (info.pages ?? 1) > 1) throw new Error();
    return await img.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().png().toBuffer();
  } catch { throw new ApiError(422, 'invalid_image', 'Upload a valid PNG, JPEG, or WebP image'); }
}
export class MediaService {
  private inFlight = new Map<string, Promise<any>>();
  constructor(readonly db: DB, readonly storage: AssetStore, readonly config: Config, readonly providers: Providers) {}
  private single<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const active = this.inFlight.get(key); if (active) return active;
    const p = fn().finally(() => this.inFlight.delete(key)); this.inFlight.set(key, p); return p;
  }
  async upload(userId: string, bytes: Buffer) { return { imageId: await this.storage.put(userId, await imagePng(bytes), 'image/png') }; }
  private async imageData(userId: string, id: string) {
    const asset = this.storage.get(id, userId);
    if (asset.mime !== 'image/png') throw new ApiError(422, 'invalid_image');
    return `data:image/png;base64,${(await this.storage.read(id, userId)).toString('base64')}`;
  }
  async segment(bytes: Buffer) {
    const png = await imagePng(bytes);
    if (this.config.MOCK_GEN) return png; // Explicit mock: no real subject isolation.
    const output = await this.providers.fal('fal-ai/imageutils/rembg', { image_url: `data:image/png;base64,${png.toString('base64')}` });
    if (typeof output.image?.url !== 'string') throw new ApiError(502, 'provider_failed');
    return imagePng(await this.providers.download(output.image.url, 16 * 1024 * 1024));
  }
  async reference(userId: string, imageId: string, species: Species) {
    const image = await this.imageData(userId, imageId);
    if (this.config.MOCK_GEN) return { imageId };
    const output = await this.providers.fal('fal-ai/flux/dev/image-to-image', { image_url: image, strength: .75, num_images: 1, output_format: 'png', prompt: `A clean front-facing full-body ${species === 'rodent' ? 'hamster' : species}, preserving the character and colors of this doodle, all limbs visible, neutral rest pose, plain white background, no text.` });
    if (typeof output.images?.[0]?.url !== 'string') throw new ApiError(502, 'provider_failed');
    return this.upload(userId, await this.providers.download(output.images[0].url, 16 * 1024 * 1024));
  }
  async startJob(userId: string, imageIds: string[], species: Species) {
    const images = await Promise.all(imageIds.map(id => this.imageData(userId, id)));
    if (this.config.MOCK_GEN && species !== 'dog' && species !== 'bird') throw new ApiError(422, 'gen_failed', 'Mock generation supports dog and bird');
    const id = randomUUID();
    const predictionId = this.config.MOCK_GEN ? null : await this.providers.trellis(images);
    this.db.prepare('INSERT INTO gen_jobs (id,user_id,species,image_ids,status,prediction_id,created_at) VALUES (?,?,?,?,?,?,?)').run(id, userId, species, JSON.stringify(imageIds), 'pending', predictionId, Date.now());
    return { jobId: id };
  }
  async job(userId: string, id: string): Promise<{ status: string; splatUrl?: string; error?: string }> {
    return this.single(`job:${userId}:${id}`, async () => {
      const j = this.db.prepare('SELECT * FROM gen_jobs WHERE id=? AND user_id=?').get(id, userId) as unknown as Job | undefined;
      if (!j) throw new ApiError(404, 'job_not_found');
      if (j.status === 'done') return { status: 'done', splatUrl: this.storage.url(j.asset_id!) };
      if (j.status === 'failed') return { status: 'failed', error: j.error! };
      try {
        if (Date.now() - j.created_at > this.config.GEN_TIMEOUT_MS) {
          if (j.prediction_id) await this.providers.cancelPrediction(j.prediction_id).catch(() => {});
          throw new ApiError(504, 'gen_timeout');
        }
        let ply: Buffer;
        if (!j.prediction_id) ply = await mockPly(this.config.bundleDir, j.species);
        else {
          const prediction = await this.providers.prediction(j.prediction_id);
          if (prediction.status === 'failed' || prediction.status === 'canceled') throw new ApiError(502, 'gen_failed');
          if (prediction.status !== 'succeeded') return { status: 'pending' };
          if (!prediction.output?.gaussian_ply) throw new ApiError(422, 'gen_low_quality');
          ply = await this.providers.download(prediction.output.gaussian_ply);
        }
        ply = normalizePly(ply);
        validatePly(ply);
        // A user may delete their data while an upstream request is in flight.
        if (!this.db.prepare('SELECT id FROM gen_jobs WHERE id=?').get(id)) throw new ApiError(404, 'job_not_found');
        const assetId = await this.storage.put(userId, ply, 'application/octet-stream');
        this.db.prepare('UPDATE gen_jobs SET status=?,asset_id=? WHERE id=?').run('done', assetId, id);
        return { status: 'done', splatUrl: this.storage.url(assetId) };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'job_not_found') throw e;
        // Transient polling/network failures leave the durable prediction available for the next poll.
        if (e instanceof ApiError && ['provider_timeout', 'rate_limited'].includes(e.code)) return { status: 'pending' };
        const code = e instanceof ApiError && ['gen_timeout', 'gen_low_quality'].includes(e.code) ? e.code : 'gen_failed';
        this.db.prepare('UPDATE gen_jobs SET status=?,error=? WHERE id=?').run('failed', code, id);
        return { status: 'failed', error: code };
      }
    });
  }
  // B1 gets a bound, per-user facade from context.forUser(userId).
  async generateProp(userId: string, prompt: string) {
    const key = hash(normalize(prompt));
    return this.single(`prop:${userId}:${key}`, async () => {
      const cached = this.db.prepare('SELECT asset_id FROM props_cache WHERE user_id=? AND cache_key=?').get(userId, key) as { asset_id: string } | undefined;
      if (cached) return { imageUrl: this.storage.url(cached.asset_id) };
      let png: Buffer;
      if (this.config.MOCK_GEN) png = await mockSticker();
      else {
        const output = await this.providers.fal('fal-ai/flux/schnell', { prompt: `Single sticker of ${prompt}, centered isolated object, plain white background, crisp playful illustration, no lettering`, num_images: 1, output_format: 'png' });
        if (typeof output.images?.[0]?.url !== 'string') throw new ApiError(502, 'provider_failed');
        png = await this.segment(await this.providers.download(output.images[0].url, 16 * 1024 * 1024));
      }
      const assetId = await this.storage.put(userId, png, 'image/png');
      this.db.prepare('INSERT INTO props_cache VALUES (?,?,?)').run(userId, key, assetId);
      return { imageUrl: this.storage.url(assetId) };
    });
  }
  async designVoice(userId: string, input: { species: Species; personality?: PetBundle['personality']; imageId?: string; description?: string }) {
    if (input.imageId) this.storage.get(input.imageId, userId);
    const personality = input.personality ?? defaults[input.species];
    let look = input.description ?? '';
    if (!look && input.imageId && !this.config.MOCK_VOICE) look = await this.providers.describe(await this.imageData(userId, input.imageId));
    const traits = Object.entries(personality).filter(([, v]) => v >= .5).map(([k]) => k).join(', ') || 'calm and friendly';
    const description = `A clear English-speaking fictional ${input.species} companion, ${traits}. ${look} Expressive, warm, natural character voice.`.slice(0, 1000);
    let voiceId: string;
    if (this.config.MOCK_VOICE) voiceId = `mock-${input.species}`;
    else {
      const preview = await this.providers.json<{ previews: { generated_voice_id: string }[] }>(await this.providers.eleven('text-to-voice/design', { voice_description: description, auto_generate_text: true }));
      if (typeof preview.previews?.[0]?.generated_voice_id !== 'string' || !preview.previews[0].generated_voice_id) throw new ApiError(502, 'provider_failed');
      const voice = await this.providers.json<{ voice_id: string }>(await this.providers.eleven('text-to-voice', { voice_name: `Fetch ${input.species}`, voice_description: description, generated_voice_id: preview.previews[0].generated_voice_id }));
      if (typeof voice.voice_id !== 'string' || !voice.voice_id) throw new ApiError(502, 'provider_failed');
      voiceId = voice.voice_id;
    }
    this.db.prepare('INSERT OR REPLACE INTO voices VALUES (?,?,?)').run(voiceId, userId, description);
    return { voiceId };
  }
  allowedVoice(userId: string, voiceId: string) {
    const configured = [this.config.ELEVENLABS_VOICE_DOG, this.config.ELEVENLABS_VOICE_CAT, this.config.ELEVENLABS_VOICE_RODENT, this.config.ELEVENLABS_VOICE_BIRD].filter(Boolean);
    return configured.includes(voiceId) || !!this.db.prepare('SELECT voice_id FROM voices WHERE voice_id=? AND user_id=?').get(voiceId, userId);
  }
  async tts(userId: string, text: string, species: Species, voiceId?: string) {
    if (voiceId && !this.allowedVoice(userId, voiceId) && !(this.config.MOCK_VOICE && voiceId === `mock-${species}`)) throw new ApiError(404, 'voice_not_found');
    if (this.config.MOCK_VOICE) return new Response(new Uint8Array(mockAudio()), { headers: { 'content-type': 'audio/wav' } });
    const id = voiceId || this.config[`ELEVENLABS_VOICE_${species.toUpperCase()}` as 'ELEVENLABS_VOICE_DOG'];
    if (!id) throw new ApiError(503, 'service_unavailable', 'Set a species default voice or design a voice first');
    return this.providers.eleven(`text-to-speech/${encodeURIComponent(id)}/stream?output_format=mp3_44100_128`, { text, model_id: this.config.ELEVENLABS_MODEL_ID });
  }
  async sfx(userId: string, prompt: string) {
    const key = hash(normalize(prompt));
    return this.single(`sfx:${userId}:${key}`, async () => {
      const c = this.db.prepare('SELECT asset_id FROM media_cache WHERE user_id=? AND kind=? AND cache_key=?').get(userId, 'sfx', key) as { asset_id: string } | undefined;
      if (c) return { audioUrl: this.storage.url(c.asset_id) };
      const response = this.config.MOCK_VOICE ? null : await this.providers.eleven('sound-generation', { text: prompt, duration_seconds: 1, prompt_influence: .4 });
      const audio = response ? await this.providers.bytes(response, 8 * 1024 * 1024) : mockAudio();
      if (!audio.length) throw new ApiError(502, 'provider_failed', 'Provider returned empty audio');
      const id = await this.storage.put(userId, audio, response ? 'audio/mpeg' : 'audio/wav');
      this.db.prepare('INSERT INTO media_cache VALUES (?,?,?,?)').run(userId, 'sfx', key, id);
      return { audioUrl: this.storage.url(id) };
    });
  }
  async sttToken() {
    if (this.config.MOCK_VOICE) throw new ApiError(503, 'stt_unavailable', 'Use browser speech recognition or text input in mock mode');
    const body = await this.providers.json<{ token: string }>(await this.providers.eleven('single-use-token/realtime_scribe'));
    if (typeof body.token !== 'string' || !body.token) throw new ApiError(502, 'provider_failed');
    return { token: body.token, expiresIn: 900 };
  }
}
export function validatePly(ply: Buffer) {
  const header = ply.subarray(0, 4096).toString('ascii'); const end = header.indexOf('end_header\n');
  const count = Number(/element vertex (\d+)/.exec(header)?.[1]);
  const props = [...header.slice(0, end).matchAll(/property float (\w+)/g)].map(m => m[1]);
  const required = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];
  const lines = header.slice(0, end).split('\n');
  if (!header.startsWith('ply\n') || !lines.includes('format binary_little_endian 1.0') || end < 0 || count < 2000 || !Number.isSafeInteger(count) || required.some(p => !props.includes(p)) || new Set(props).size !== props.length || lines.some(line => line.startsWith('property ') && !/^property float \w+$/.test(line)) || lines.filter(line => line.startsWith('element ')).length !== 1 || ply.length < end + 11 + count * props.length * 4) throw new ApiError(422, 'gen_low_quality');
  const dataStart = end + 11;
  const indices = required.map(p => props.indexOf(p));
  for (let i = 0; i < count; i++) {
    const offset = dataStart + i * props.length * 4;
    for (const index of indices) if (!Number.isFinite(ply.readFloatLE(offset + index * 4))) throw new ApiError(422, 'gen_low_quality');
    for (const name of ['scale_0', 'scale_1', 'scale_2']) {
      const scale = ply.readFloatLE(offset + props.indexOf(name) * 4);
      if (scale < -30 || scale > 30) throw new ApiError(422, 'gen_low_quality');
    }
    const norm = ['rot_0', 'rot_1', 'rot_2', 'rot_3'].reduce((n, name) => n + ply.readFloatLE(offset + props.indexOf(name) * 4) ** 2, 0);
    if (norm < 1e-12) throw new ApiError(422, 'gen_low_quality');
  }
}
/** F1's codec expects an ASCII LF header. Preserve all binary payload bytes. */
export function normalizePly(ply: Buffer) {
  const header = ply.subarray(0, 4096).toString('ascii');
  const end = /end_header\r?\n/.exec(header);
  if (!end) throw new ApiError(422, 'gen_low_quality');
  const dataStart = end.index + end[0].length;
  const normalized = header.slice(0, dataStart).replace(/\r\n/g, '\n');
  return Buffer.concat([Buffer.from(normalized, 'ascii'), ply.subarray(dataStart)]);
}
