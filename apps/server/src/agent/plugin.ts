// B1 entry point. B2's scaffold registers this once:
//   await registerB1(app, { pets: PetsRepo, media })
// It owns /session, /auth/*, /connectors/*, /mode, /agent/*, /notifications/* (PRD 0.1).
import { EventEmitter } from 'node:events';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../auth/routes';
import { resolveKey } from '../auth/crypto';
import { ApprovalGate } from './approvals';
import type { Brain } from './brain';
import { isDevSecret, loadConfig, type B1Config } from './config';
import type { B1Context } from './context';
import { RunHub } from './hub';
import { mockBrain } from './mockBrain';
import { agentRoutes } from './routes';
import { AgentRunner } from './runner';
import { MemoryStore, type B1Store } from './store';
import type { MediaService, PetsRepo } from './types';

export interface B1Options {
  pets: PetsRepo;
  media: MediaService;
  store?: B1Store;
  config?: Partial<B1Config>;
  /** Overrides the agent brain (tests). Defaults to MOCK_AGENT's scripts or Claude. */
  brain?: Brain;
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
  const hub = new RunHub(ctx.store);
  const brain = opts.brain ?? (config.mockAgent ? mockBrain(Number(process.env.MOCK_AGENT_DELAY_MS ?? 700)) : unavailableBrain);
  const runner = new AgentRunner(ctx, hub, new ApprovalGate(), brain);

  await authRoutes(app, ctx);
  await agentRoutes(app, ctx, hub, runner);
  return { ctx, hub, runner };
}

const unavailableBrain: Brain = () => ({
  async next() { throw Object.assign(new Error('No agent brain configured; set MOCK_AGENT=1'), { status: 503 }); },
});
