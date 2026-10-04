// Shared state for B1 route modules, built once in registerB1().
import { EventEmitter } from 'node:events';
import type { ComposioGateway } from '../connectors/composio';
import type { B1Config } from './config';
import type { B1Store } from './store';
import type { ToolDef } from './tools';
import type { MediaService, Mode, PetsRepo } from './types';
import { connectedFromScopes, type ConnectorName } from '../auth/google';

export interface B1Context {
  config: B1Config;
  store: B1Store;
  pets: PetsRepo;
  media: MediaService;
  tokenKey: Buffer;
  /** Emits ('mode', userId, mode) whenever a user's mode changes. */
  modeEvents: EventEmitter;
  /** Set when COMPOSIO_API_KEY is configured (and MOCK_CONNECTORS is off). */
  composio?: ComposioGateway;
  /** The tools the agent gets for this deployment (see toolset.ts). */
  tools: ToolDef[];
}

/** Composio toolkit slugs for the three connectors the UI shows chips for. */
export const COMPOSIO_SLUG: Record<ConnectorName, string> = { gmail: 'gmail', calendar: 'googlecalendar', drive: 'googledrive' };

export async function connectorStatus(ctx: B1Context, userId: string): Promise<Record<ConnectorName, boolean>> {
  if (ctx.config.mockConnectors) return { gmail: true, calendar: true, drive: true };
  if (ctx.composio) {
    const apps = await connectedApps(ctx, userId);
    return { gmail: apps.includes(COMPOSIO_SLUG.gmail), calendar: apps.includes(COMPOSIO_SLUG.calendar), drive: apps.includes(COMPOSIO_SLUG.drive) };
  }
  const token = await ctx.store.getToken(userId, 'google');
  return token ? connectedFromScopes(token.scopes) : { gmail: false, calendar: false, drive: false };
}

/** Every app the user has connected through Composio (empty without Composio). */
export async function connectedApps(ctx: B1Context, userId: string): Promise<string[]> {
  if (!ctx.composio) return [];
  try { return await ctx.composio.connectedToolkits(userId); } catch { return []; }
}

export async function setMode(ctx: B1Context, userId: string, mode: Mode) {
  const state = await ctx.store.setUserState(userId, { mode });
  ctx.modeEvents.emit('mode', userId, mode);
  return state;
}
