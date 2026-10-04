import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGzip, createBrotliCompress } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../errors.js';
import type { ServerContext } from '../app.js';
import { imagePng } from './service.js';
import { QuotaError } from './providers.js';
import { petMetadataSchema, petPatchSchema, personalitySchema, speciesSchema } from './types.js';

async function multipart(request: FastifyRequest, allowed: string[]) {
  if (!request.isMultipart()) throw new ApiError(415, 'multipart_required');
  const files: Record<string, Buffer> = {}; const fields: Record<string, string> = {};
  let total = 0;
  for await (const part of request.parts()) {
    if (!allowed.includes(part.fieldname) || files[part.fieldname] || fields[part.fieldname] !== undefined) throw new ApiError(422, 'invalid_upload', 'Unknown or duplicate multipart field');
    if (part.type === 'file') files[part.fieldname] = await part.toBuffer();
    else {
      if (part.valueTruncated || part.fieldnameTruncated) throw new ApiError(413, 'upload_too_large');
      fields[part.fieldname] = String(part.value);
    }
    total += files[part.fieldname]?.length ?? Buffer.byteLength(fields[part.fieldname]);
    if (total > 32 * 1024 * 1024) throw new ApiError(413, 'upload_too_large');
  }
  return { files, fields };
}
const required = (files: Record<string, Buffer>, name: string) => {
  const b = files[name]; if (!b?.length) throw new ApiError(422, 'invalid_upload', `Missing ${name}`); return b;
};
const json = (text: string) => { try { return JSON.parse(text); } catch { throw new ApiError(422, 'invalid_json'); } };
const promptSchema = z.object({ prompt: z.string().trim().min(1).max(500) }).strict();
const imageIdSchema = z.string().uuid();
const boneSchema = z.object({ name: z.string().min(1), parent: z.number().int(), head: z.tuple([z.number(), z.number(), z.number()]), tail: z.tuple([z.number(), z.number(), z.number()]) });

export async function registerMediaRoutes(app: FastifyInstance, ctx: ServerContext) {
  const { storage, pets, media, config } = ctx;
  // Signed URLs carry narrowly scoped read authorization; no session needed by WebGL/audio loaders.
  app.get('/assets/:id', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ expires: z.coerce.number().int(), signature: z.string() }).parse(req.query);
    storage.verify(id, q.expires, q.signature); const asset = storage.get(id);
    reply.header('Content-Type', asset.mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', `private, max-age=${Math.min(60, Math.max(0, q.expires - Math.floor(Date.now() / 1000)))}`).header('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0, end = asset.size - 1;
      if (!m || (!m[1] && !m[2])) return reply.code(416).header('Content-Range', `bytes */${asset.size}`).send();
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
      else { const suffix = Number(m[2]); if (suffix <= 0) return reply.code(416).header('Content-Range', `bytes */${asset.size}`).send(); start = Math.max(0, asset.size - suffix); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= asset.size) return reply.code(416).header('Content-Range', `bytes */${asset.size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${asset.size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(storage.path(id), { start, end }));
    }
    const stream = createReadStream(storage.path(id));
    const accept = req.headers['accept-encoding'] ?? '';
    if (asset.mime === 'application/octet-stream' || asset.mime === 'application/json') {
      reply.header('Vary', [reply.getHeader('Vary'), 'Accept-Encoding'].filter(Boolean).join(', '));
      const encodings = accept.split(',').map(v => v.trim().split(';')).filter(([, q]) => !q || Number(q.replace('q=', '')) > 0).map(([v]) => v);
      if (encodings.includes('br') || encodings.includes('gzip')) {
        const encoding = encodings.includes('br') ? 'br' : 'gzip';
        const compressed = encoding === 'br' ? createBrotliCompress() : createGzip();
        stream.on('error', error => compressed.destroy(error));
        compressed.on('close', () => stream.destroy());
        return reply.header('Content-Encoding', encoding).send(stream.pipe(compressed));
      }
    }
    return reply.header('Content-Length', asset.size).send(stream);
  });

  await app.register(async scoped => {
    scoped.addHook('preHandler', ctx.requireUser);
    scoped.addHook('onRoute', route => {
      const handler = route.handler;
      route.handler = async function(req, reply) {
        if (!req.user?.id) throw new ApiError(401, 'auth_required');
        if (req.method === 'DELETE' && req.routeOptions.url === '/pets') return handler.call(this, req, reply);
        const release = ctx.userWork.enter(req.user.id);
        try { return await handler.call(this, req, reply); } finally { release(); }
      };
    });
    scoped.addHook('onSend', async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store').header('X-Fetch-Mock-Gen', String(config.MOCK_GEN)).header('X-Fetch-Mock-Voice', String(config.MOCK_VOICE));
      return payload;
    });
    const user = (req: FastifyRequest) => { if (!req.user?.id) throw new ApiError(401, 'auth_required'); return req.user.id; };
    scoped.post('/uploads', async req => {
      const { files } = await multipart(req, ['image']); return media.upload(user(req), required(files, 'image'));
    });
    // The shared error handler only sends {code,message}; free-tier quota also tells the UI when to retry.
    const quota = (e: unknown, reply: FastifyReply) => {
      if (!(e instanceof QuotaError) || !e.retryAfter) throw e;
      return reply.code(429).header('Retry-After', e.retryAfter).send({ code: e.code, message: e.message, retryAfter: e.retryAfter });
    };
    scoped.post('/gen/segment', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { files } = await multipart(req, ['image']);
      let png: Buffer;
      try { png = await media.segment(required(files, 'image')); } catch (e) { return quota(e, reply); }
      return reply.type('image/png').send(png);
    });
    scoped.post('/gen/reference', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const b = z.object({ imageId: imageIdSchema, species: speciesSchema, kind: z.enum(['drawing', 'photo']).default('drawing'), style: z.enum(['photoreal', 'plush']).default('photoreal') }).strict().parse(req.body);
      try { return await media.reference(user(req), b.imageId, b.species, b.kind, b.style); } catch (e) { return quota(e, reply); }
    });
    scoped.post('/gen/image-to-3d', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
      const b = z.object({ imageIds: z.array(imageIdSchema).refine(v => v.length === 1 || v.length === 3, 'Provide one or three images'), species: speciesSchema }).strict().parse(req.body);
      return media.startJob(user(req), b.imageIds, b.species);
    });
    scoped.get('/gen/jobs/:id', { config: { rateLimit: { max: 180, timeWindow: '1 minute' } } }, async req => {
      return media.job(user(req), z.object({ id: z.string().uuid() }).parse(req.params).id);
    });
    scoped.post('/gen/prop', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => media.generateProp(user(req), promptSchema.parse(req.body).prompt));
    scoped.post('/pets', async (req, reply) => {
      const { files, fields } = await multipart(req, ['splat', 'rig', 'weights', 'thumbnail', 'metadata']);
      const meta = petMetadataSchema.parse(json(fields.metadata ?? ''));
      if (meta.voiceId && !media.allowedVoice(user(req), meta.voiceId)) throw new ApiError(404, 'voice_not_found');
      const splat = required(files, 'splat'), rig = required(files, 'rig'), weights = required(files, 'weights');
      const n = splat.length / 32;
      if (!Number.isInteger(n) || n < 1 || n > 300000 || weights.length !== n * 8 || rig.length > 1024 * 1024) throw new ApiError(422, 'invalid_bundle', 'Invalid splat budget, rig, or skin-weight length');
      const skeleton = z.object({ bones: z.array(boneSchema).min(1).max(256) }).parse(json(rig.toString()));
      skeleton.bones.forEach((bone, i) => { if (bone.parent < -1 || bone.parent >= i) throw new ApiError(422, 'invalid_bundle', 'Rig parents must precede children'); });
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 6; k++) {
          const v = splat.readFloatLE(i * 32 + k * 4);
          if (!Number.isFinite(v) || (k >= 3 && v <= 0)) throw new ApiError(422, 'invalid_bundle');
        }
        let sum = 0;
        for (let k = 0; k < 4; k++) { if (weights[i * 8 + k] >= skeleton.bones.length) throw new ApiError(422, 'invalid_bundle'); sum += weights[i * 8 + 4 + k]; }
        if (sum !== 255) throw new ApiError(422, 'invalid_bundle', 'Bone weights must sum to 255');
      }
      const thumbnail = await imagePng(required(files, 'thumbnail')); const ids: string[] = [];
      try {
        const put = async (b: Buffer, mime: string) => { const id = await storage.put(user(req), b, mime); ids.push(id); return id; };
        const assets = { splat: await put(splat, 'application/octet-stream'), rig: await put(rig, 'application/json'), weights: await put(weights, 'application/octet-stream'), thumbnail: await put(thumbnail, 'image/png') };
        return reply.code(201).send(pets.create(user(req), meta, assets));
      } catch (e) { for (const id of ids) await storage.remove(id); throw e; }
    });
    scoped.get('/pets', async req => pets.list(user(req)));
    scoped.get('/pets/:id', async req => pets.getBundle(z.object({ id: z.string().uuid() }).parse(req.params).id, user(req)));
    scoped.patch('/pets/:id', async req => {
      const b = petPatchSchema.parse(req.body);
      if (b.voiceId && !media.allowedVoice(user(req), b.voiceId)) throw new ApiError(404, 'voice_not_found');
      return pets.patch(z.object({ id: z.string().uuid() }).parse(req.params).id, user(req), b);
    });
    scoped.delete('/pets/:id', async (req, reply) => { await pets.delete(z.object({ id: z.string().uuid() }).parse(req.params).id, user(req)); return reply.code(204).send(); });
    scoped.post('/voice/design', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
      const b = z.object({ species: speciesSchema, personality: personalitySchema.optional(), imageId: imageIdSchema.optional(), description: z.string().trim().min(1).max(600).optional() }).strict().parse(req.body);
      return media.designVoice(user(req), b);
    });
    scoped.post('/voice/tts', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      const b = z.object({ text: z.string().trim().min(1).max(2000), species: speciesSchema.default('dog'), voiceId: z.string().min(1).max(100).optional() }).strict().parse(req.body);
      const upstream = await media.tts(user(req), b.text, b.species, b.voiceId);
      if (!upstream.body) throw new ApiError(502, 'provider_failed');
      const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
      reply.raw.on('close', () => stream.destroy());
      return reply.type(upstream.headers.get('content-type') ?? 'audio/mpeg').send(stream);
    });
    scoped.post('/voice/sfx', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => media.sfx(user(req), promptSchema.parse(req.body).prompt));
    scoped.post('/voice/sfx/batch', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
      const b = z.object({ prompts: z.array(promptSchema.shape.prompt).min(1).max(8) }).strict().parse(req.body);
      // Sequential avoids a burst of eight provider calls during onboarding.
      const items = []; for (const prompt of b.prompts) items.push({ prompt, ...await media.sfx(user(req), prompt) }); return { items };
    });
    // one single-use token per mic turn (the client keeps one ready), so allow a turn every 2 s
    scoped.get('/voice/stt-token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => media.sttToken());
    scoped.delete('/pets', async (req, reply) => {
      const uid = user(req);
      await ctx.deleteUserMedia(uid);
      return reply.code(204).send();
    });
  });
}
