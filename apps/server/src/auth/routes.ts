// /session, /auth/google/*, /connectors/:name, /mode (PRD B1.2).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COMPOSIO_SLUG, connectedApps, connectorStatus, setMode, type B1Context } from '../agent/context';
import { authUrl, completeOAuth, googleConfigured, revokeGoogle, CONNECTOR_NAMES, type ConnectorName } from './google';
import { requireUser, setUserCookie } from './requireUser';

const STATE_COOKIE = 'fetch_oauth_state';

export async function authRoutes(app: FastifyInstance, ctx: B1Context) {
  const auth = requireUser(ctx.config, ctx.store);
  const secure = ctx.config.webOrigin.startsWith('https:');
  const backToWeb = (query: string) => `${ctx.config.webOrigin}/?${query}`;

  app.get('/session', { preHandler: auth }, async (req) => {
    const user = req.user!;
    const state = await ctx.store.getUserState(user.id);
    return {
      user: { id: user.id, name: user.name, email: user.email },
      userName: user.name,
      connected: await connectorStatus(ctx, user.id),
      mode: state.mode,
      activePetId: state.activePetId ?? null,
      mock: { agent: ctx.config.mockAgent, connectors: ctx.config.mockConnectors },
      googleConfigured: googleConfigured(ctx.config),
      /** Composio: every connected app slug (any app works; others connect on first use). */
      apps: await connectedApps(ctx, user.id),
      composio: Boolean(ctx.composio),
    };
  });

  app.patch('/session', { preHandler: auth }, async (req, reply) => {
    const body = z.object({ activePetId: z.string().min(1).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const state = await ctx.store.setUserState(req.user!.id, { activePetId: body.data.activePetId ?? undefined });
    return { activePetId: state.activePetId ?? null };
  });

  app.post('/mode', { preHandler: auth }, async (req, reply) => {
    const body = z.object({ mode: z.enum(['work', 'play']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const state = await setMode(ctx, req.user!.id, body.data.mode);
    return { mode: state.mode };
  });

  app.get('/auth/google/start', { preHandler: auth }, async (req, reply) => {
    if (!googleConfigured(ctx.config)) {
      // Mock connectors need no OAuth; tell the web app instead of failing.
      return reply.redirect(backToWeb(ctx.config.mockConnectors ? 'connected=mock' : 'connect_error=oauth_not_configured'));
    }
    const nonce = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, `${nonce}.${req.user!.id}`, {
      path: '/auth/google', httpOnly: true, sameSite: 'lax', secure, signed: true, maxAge: 600,
    });
    return reply.redirect(authUrl(ctx.config, nonce));
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const raw = req.cookies?.[STATE_COOKIE];
    const cookie = raw ? req.unsignCookie(raw) : undefined;
    reply.clearCookie(STATE_COOKIE, { path: '/auth/google' });
    if (q.error) return reply.redirect(backToWeb(`connect_error=${encodeURIComponent(q.error)}`));
    const [nonce, userId] = cookie?.valid && cookie.value ? cookie.value.split('.') : [];
    if (!q.code || !q.state || !nonce || q.state !== nonce || !userId) {
      return reply.redirect(backToWeb('connect_error=invalid_state'));
    }
    try {
      const identity = await completeOAuth(ctx.config, ctx.store, ctx.tokenKey, userId, q.code);
      const existing = await ctx.store.getUser(userId);
      await ctx.store.upsertUser({
        id: userId, createdAt: existing?.createdAt ?? new Date().toISOString(),
        name: identity.name ?? existing?.name ?? 'Fetch User', email: identity.email ?? existing?.email,
      });
      setUserCookie(reply, userId, secure);
      return reply.redirect(backToWeb('connected=google'));
    } catch (err) {
      req.log.warn({ err }, 'google oauth callback failed');
      return reply.redirect(backToWeb(`connect_error=${(err as { code?: string }).code ?? 'oauth_failed'}`));
    }
  });

  // With Composio, each app is its own connection: :name is gmail|calendar|drive or any Composio app slug.
  // Without it, one Google grant backs all three connectors, so disconnecting any of them revokes the grant.
  app.delete('/connectors/:name', { preHandler: auth }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (ctx.composio) {
      if (!/^[a-z0-9_-]{2,60}$/.test(name)) return reply.code(404).send({ error: 'unknown_connector' });
      const slug = COMPOSIO_SLUG[name as ConnectorName] ?? name;
      try { await ctx.composio.disconnect(req.user!.id, slug); }
      catch { return reply.code(502).send({ error: 'disconnect_failed' }); }
      return { disconnected: [slug], connected: await connectorStatus(ctx, req.user!.id), apps: await connectedApps(ctx, req.user!.id) };
    }
    if (name !== 'google' && !CONNECTOR_NAMES.includes(name as never)) return reply.code(404).send({ error: 'unknown_connector' });
    await revokeGoogle(ctx.config, ctx.store, ctx.tokenKey, req.user!.id);
    return { disconnected: CONNECTOR_NAMES, connected: await connectorStatus(ctx, req.user!.id) };
  });
}
