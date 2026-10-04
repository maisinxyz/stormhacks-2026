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
import { composioGateway, type ComposioGateway } from '../connectors/composio';
import { RunHub } from './hub';
import { toolset } from './toolset';
import { claudeBrain } from './llm';
import { geminiBrain } from './gemini';
import { mockBrain } from './mockBrain';
import { notificationRoutes, type NotifyOptions } from './notifications';
import { agentRoutes } from './routes';
import { AgentRunner } from './runner';
import { MemoryStore, type B1Store } from './store';
import type { MediaService, PetsRepo } from './types';

export interface B1Options {
  pets: PetsRepo;
  media: MediaService;
  store?: B1Store;
  config?: Partial<B1Config>;
  /** Overrides the agent brain (tests). Defaults to MOCK_AGENT's scripts or the configured model provider. */
  brain?: Brain;
  notify?: Partial<NotifyOptions>;
  /** Overrides the Composio gateway (tests). Defaults to a real one when COMPOSIO_API_KEY is set. */
  composio?: ComposioGateway;
}

export async function registerB1(app: FastifyInstance, opts: B1Options) {
  const config = { ...loadConfig(), ...opts.config };
  if (isDevSecret(config)) {
    // The dev secret is public, so anyone could sign a session cookie for any user.
    if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set in production');
    app.log.warn('SESSION_SECRET not set; using a dev-only secret');
  }
  if (!app.hasDecorator('unsignCookie')) await app.register(cookie, { secret: config.sessionSecret });

  const ctx: B1Context = {
    config,
    store: opts.store ?? new MemoryStore(),
    pets: opts.pets,
    media: opts.media,
    tokenKey: resolveKey(config.tokenEncKey, config.sessionSecret),
    modeEvents: new EventEmitter().setMaxListeners(0),
    tools: [],
  };
  // Composio (any app, connected on demand) unless MOCK_CONNECTORS asks for the offline demo workspace.
  // MOCK_AGENT's canned scripts drive the native tools, so they keep the native toolset too.
  if (!config.mockConnectors && (!config.mockAgent || opts.composio)) {
    ctx.composio = opts.composio ?? (config.composio.apiKey
      ? composioGateway({ apiKey: config.composio.apiKey, callbackUrl: config.composio.callbackUrl })
      : undefined);
  }
  ctx.tools = toolset(Boolean(ctx.composio));
  app.log.info({ composio: Boolean(ctx.composio), tools: ctx.tools.map(t => t.name) }, 'B1 agent tools');

  const hub = new RunHub(ctx.store);
  const brain = opts.brain ?? (config.mockAgent
    ? mockBrain(Number(process.env.MOCK_AGENT_DELAY_MS ?? 700))
    : config.modelProvider === 'gemini'
      ? geminiBrain({ apiKey: config.gemini.apiKey, agentModel: config.agentModel }, undefined, ctx.tools)
      : claudeBrain({ agentModel: config.agentModel, effort: (process.env.AGENT_EFFORT as 'low') ?? 'low' }, undefined, ctx.tools));
  const runner = new AgentRunner(ctx, hub, new ApprovalGate(), brain);

  await authRoutes(app, ctx);
  await agentRoutes(app, ctx, hub, runner);
  await notificationRoutes(app, ctx, opts.notify);
  return { ctx, hub, runner };
}
