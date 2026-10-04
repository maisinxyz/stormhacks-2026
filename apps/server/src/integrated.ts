import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { buildApp, type AppOptions, type RequireUser } from './app.js';
import { registerB1, type B1Options } from './agent/plugin.js';
import { isDevSecret, loadConfig } from './agent/config.js';
import { requireUser } from './auth/requireUser.js';
import { ApiError } from './errors.js';

export interface FetchAppOptions extends Omit<AppOptions, 'requireUser' | 'registerB1'> {
  b1?: Omit<B1Options, 'pets' | 'media'>;
}

/** Mount both owners on one server; B1 owns session authentication and agent behavior. */
export async function buildFetchApp(options: FetchAppOptions = {}) {
  const userScope = new AsyncLocalStorage<string>();
  let auth: RequireUser | undefined;
  let b1: Awaited<ReturnType<typeof registerB1>> | undefined;
  const server = await buildApp({ ...options,
    requireUser: async (req, reply) => {
      if (!auth) throw new ApiError(503, 'auth_unavailable');
      await auth(req, reply);
    },
    registerB1: async (app, context) => {
      const config = { ...loadConfig(), ...options.b1?.config };
      if (!config.sessionSecret && context.config.NODE_ENV !== 'production') config.sessionSecret = loadConfig({}).sessionSecret;
      if (context.config.NODE_ENV === 'production') {
        if (isDevSecret(config) || config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters in production');
        config.requireLogin = true;
      }
      // Register at the parent so cookie parsing also reaches the B2 media scope.
      await app.register(cookie, { secret: config.sessionSecret });
      await app.register(async scoped => {
        // B1's background run inherits the authenticated request's async context.
        scoped.addHook('onRoute', route => {
          const handler = route.handler;
          route.handler = async function(req, reply) {
            if (!req.user) return handler.call(this, req, reply);
            if (req.method === 'POST' && req.routeOptions.url === '/agent/run') {
              const body = req.body as { petId?: unknown } | undefined;
              // Preserve B1's mode-forbidden response before inspecting a pet or body.
              const mode = await b1!.ctx.store.getUserState(req.user.id);
              if (mode.mode === 'work' && typeof body?.petId === 'string' && body.petId.length > 0 && body.petId.length <= 200) context.pets.getBundle(body.petId, req.user.id);
            }
            return userScope.run(req.user.id, () => handler.call(this, req, reply));
          };
        });
        b1 = await registerB1(scoped, { ...options.b1, config,
          pets: { get: async petId => {
            const userId = userScope.getStore();
            if (!userId) throw new ApiError(401, 'auth_required');
            context.pets.getBundle(petId, userId);
            return context.pets.get(petId);
          } },
          media: { generateProp: async prompt => {
            const userId = userScope.getStore();
            if (!userId) throw new ApiError(401, 'auth_required');
            return context.forUser(userId).media.generateProp(prompt);
          } }
        });
        const hook = requireUser(b1.ctx.config, b1.ctx.store);
        auth = async (req, reply) => hook.call(scoped as FastifyInstance, req, reply, () => {});
      });
    }
  });
  // Fastify finishes registering plugins at ready(); this also initializes B1 auth.
  try { await server.app.ready(); }
  catch (e) { await server.app.close(); throw e; }
  return { ...server, b1: b1! };
}
