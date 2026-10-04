import { existsSync } from 'node:fs';
import { buildFetchApp } from './integrated.js';
// Run from apps/server. Environment values supplied by the host take precedence.
if (existsSync('.env')) process.loadEnvFile('.env');
const { app, context } = await buildFetchApp();
try { await app.listen({ host: context.config.HOST, port: context.config.PORT }); }
catch { app.log.error('Could not start Fetch server'); await app.close(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
