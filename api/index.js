// Vercel function: the whole Fastify API behind one handler. Built by scripts/vercel-build.mjs.
// Demo hosting: the server's production mode forces Google login, which needs OAuth credentials, so this runs in its
// non-production auth mode (shared demo user). Set FETCH_NODE_ENV=production once Google OAuth + SESSION_SECRET exist.
// State (SQLite in /tmp, in-memory agent store) lives per warm instance and is lost on cold start.
process.env.NODE_ENV = process.env.FETCH_NODE_ENV ?? 'development';

let ready;
export default async function handler(req, res) {
  ready ??= import('../apps/server/dist/index.js').then(async ({ buildFetchApp }) => { const { app } = await buildFetchApp(); await app.ready(); return app; });
  (await ready).server.emit('request', req, res);
}
