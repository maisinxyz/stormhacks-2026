// B1 entry point. B2's scaffold registers this once:
//   await app.register(registerB1, { pets: PetsRepo, media })
// It owns /session, /auth/*, /connectors/*, /mode, /agent/*, /notifications/* (PRD 0.1).
import { EventEmitter } from 'node:events';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../auth/routes';
import { resolveKey } from '../auth/crypto';
import { isDevSecret, loadConfig, type B1Config } from './config';
import type { B1Context } from './context';
import { MemoryStore, type B1Store } from './store';
import type { MediaService, PetsRepo } from './types';

export interface B1Options {
  pets: PetsRepo;
  media: MediaService;
  store?: B1Store;
  config?: Partial<B1Config>;
}

export async function registerB1(app: FastifyInstance, opts: B1Options) {
  const config = { ...loadConfig(), ...opts.config };
  if (isDevSecret(config)) app.log.warn('SESSION_SECRET not set; using a dev-only secret');
  if (!app.hasDecorator('unsignCookie')) await app.register(cookie, { secret: config.sessionSecret });

  const ctx: B1Context = {
    config,
    store: opts.store ?? new MemoryStore(),
    pets: opts.pets,
    media: opts.media,
    tokenKey: resolveKey(config.tokenEncKey, config.sessionSecret),
    modeEvents: new EventEmitter().setMaxListeners(0),
  };

  await authRoutes(app, ctx);
  return ctx;
}
