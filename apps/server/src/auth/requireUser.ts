// requireUser() (PRD 0.1: owned by B1, replaces B2's dev stub).
// Identity is a signed `fetch_uid` cookie. Without one, requests act as the shared demo
// user unless REQUIRE_LOGIN=1 (multi-user is a non-goal; this keeps cookie-less clients working).
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { B1Config } from '../agent/config';
import type { B1Store } from '../agent/store';
import type { User } from '../agent/types';

export const USER_COOKIE = 'fetch_uid';

declare module 'fastify' {
  interface FastifyRequest { user?: User }
}

export function requireUser(config: B1Config, store: B1Store): preHandlerHookHandler {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const raw = req.cookies?.[USER_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : undefined;
    let userId = unsigned?.valid ? unsigned.value ?? undefined : undefined;

    if (!userId) {
      if (config.requireLogin) return reply.code(401).send({ error: 'auth_required' });
      userId = config.demoUserId;
    }

    let user = await store.getUser(userId);
    if (!user) {
      if (userId !== config.demoUserId) return reply.code(401).send({ error: 'auth_required' });
      user = { id: userId, name: 'Demo User', createdAt: new Date().toISOString() };
      await store.upsertUser(user);
    }
    req.user = user;
  };
}

export function setUserCookie(reply: FastifyReply, userId: string, secure: boolean) {
  reply.setCookie(USER_COOKIE, userId, {
    path: '/', httpOnly: true, sameSite: 'lax', secure, signed: true, maxAge: 60 * 60 * 24 * 30,
  });
}
