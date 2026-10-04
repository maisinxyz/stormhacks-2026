// Standalone B1 dev server, until B2's scaffold mounts registerB1().
//   MOCK_AGENT=1 MOCK_CONNECTORS=1 pnpm --filter @fetch/server dev:b1
import { buildB1App } from './testApp';

const port = Number(process.env.PORT ?? 8787);
const { app, ctx } = await buildB1App({}, true);
await app.listen({ port, host: '127.0.0.1' });
app.log.info({ mockAgent: ctx.config.mockAgent, mockConnectors: ctx.config.mockConnectors }, `B1 dev server on :${port}`);
