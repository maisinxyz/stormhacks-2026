import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { readConfig, type Config } from './config.js';
import { openDatabase } from './db/index.js';
import { PetsRepository } from './db/pets.js';
import { ApiError } from './errors.js';
import { AssetStore } from './media/storage.js';
import { Providers, type Fetcher } from './media/providers.js';
import { MediaService } from './media/service.js';
import { registerMediaRoutes } from './media/routes.js';
import { UserWork } from './media/user-work.js';

// B1 owns FastifyRequest.user and its User shape. Keep one declaration across the server.
export type RequireUser = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface ServerContext {
  config: Config; db: ReturnType<typeof openDatabase>; storage: AssetStore; pets: PetsRepository; media: MediaService;
  requireUser: RequireUser;
  userWork: UserWork;
  forUser(userId: string): { media: { generateProp(prompt: string): Promise<{ imageUrl: string }> } };
  deleteUserMedia(userId: string): Promise<void>;
}
export interface AppOptions {
  config?: Config; requireUser?: RequireUser; fetcher?: Fetcher; logger?: boolean;
  registerB1?: (app: FastifyInstance, context: ServerContext) => Promise<void>;
}
export async function buildApp(options: AppOptions = {}) {
  const config = options.config ?? readConfig();
  if (config.NODE_ENV === 'production' && !options.requireUser) throw new Error('B1 requireUser must be supplied in production');
  const app = Fastify({ logger: options.logger === false ? false : {
    level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["xi-api-key"]'],
    serializers: { req: req => ({ method: req.method, url: req.url.split('?')[0], id: req.id }) }
  }, bodyLimit: 1024 * 1024, requestTimeout: 240000, trustProxy: false });
  const db = openDatabase(config.DATA_DIR); const storage = new AssetStore(db, config);
  const pets = new PetsRepository(db, storage); const media = new MediaService(db, storage, config, new Providers(config, options.fetcher));
  if (!app.hasRequestDecorator('user')) app.decorateRequest('user');
  const requireUser: RequireUser = options.requireUser ?? (async req => {
    if (!config.DEV_AUTH || config.NODE_ENV === 'production') throw new ApiError(401, 'auth_required');
    req.user = { id: 'demo-user', name: 'Demo User', createdAt: new Date().toISOString() };
  });
  const userWork = new UserWork();
  app.addHook('onClose', async () => { try { await userWork.close(); } finally { db.close(); } });
  const ctx: ServerContext = { config, db, storage, pets, media, requireUser, userWork,
    forUser: userId => ({ media: { generateProp: async prompt => {
      const release = userWork.enter(userId);
      try { return await media.generateProp(userId, prompt); } finally { release(); }
    } } }),
    async deleteUserMedia(userId) {
      return userWork.delete(userId, async () => {
      for (const pet of pets.list(userId)) await pets.delete(pet.id, userId);
      const jobs = db.prepare('SELECT prediction_id FROM gen_jobs WHERE user_id=? AND prediction_id IS NOT NULL AND status=?').all(userId, 'pending') as { prediction_id: string }[];
      db.prepare('DELETE FROM gen_jobs WHERE user_id=?').run(userId);
      for (const job of jobs) await media.providers.cancelPrediction(job.prediction_id).catch(() => {});
      const assets = db.prepare('SELECT id FROM assets WHERE user_id=?').all(userId) as { id: string }[];
      for (const asset of assets) await storage.remove(asset.id);
      db.prepare('DELETE FROM voices WHERE user_id=?').run(userId);
      });
    }
  };
  try {
  await app.register(cors, { origin: config.origins, credentials: true, exposedHeaders: ['Content-Range', 'Accept-Ranges', 'X-Fetch-Mock-Gen', 'X-Fetch-Mock-Voice'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', errorResponseBuilder: () => new ApiError(429, 'rate_limited', 'Please try again shortly') });
  await app.register(multipart, { limits: { fileSize: 16 * 1024 * 1024, files: 4, fields: 1, fieldSize: 16 * 1024, parts: 5 }, throwFileSizeLimit: true });
  app.addHook('onRequest', async req => {
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) throw new ApiError(403, 'origin_forbidden');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ code: 'invalid_request', message: 'Check the request fields', issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    const e = error as { statusCode?: number; code?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ code: e.statusCode === 413 ? 'upload_too_large' : 'invalid_request', message: 'Request could not be accepted' });
    req.log.error({ code: e.code ?? 'internal_error', requestId: req.id }, 'Server request failed');
    return reply.code(500).send({ code: 'internal_error', message: 'Something went wrong. Please try again.' });
  });
  app.get('/health', async () => { db.prepare('SELECT 1').get(); return { ok: true, mockGen: config.MOCK_GEN, mockVoice: config.MOCK_VOICE, devAuth: config.DEV_AUTH }; });
  if (options.registerB1) await options.registerB1(app, ctx);
  await registerMediaRoutes(app, ctx);
  return { app, context: ctx };
  } catch (e) { await app.close(); throw e; }
}
