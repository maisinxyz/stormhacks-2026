import type { B1Context } from '../agent/context';
import { userGoogleClient } from '../auth/google';
import { googleConnectors } from './google';
import { mockWorkspace } from './mock';
import { ConnectorError, type Connectors } from './types';

/** The user's connectors: the seeded mock workspace under MOCK_CONNECTORS, else their Google account. */
export async function connectorsFor(ctx: B1Context, userId: string): Promise<Connectors> {
  if (ctx.config.mockConnectors) return mockWorkspace(userId);
  const google = await userGoogleClient(ctx.config, ctx.store, ctx.tokenKey, userId);
  if (!google) throw new ConnectorError('auth_required', 'Google is not connected. Connect it from Settings.');
  return googleConnectors(google.client);
}

export * from './types';
