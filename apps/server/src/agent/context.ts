// Shared state for B1 route modules, built once in registerB1().
import { EventEmitter } from 'node:events';
import type { B1Config } from './config';
import type { B1Store } from './store';
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
}

export async function connectorStatus(ctx: B1Context, userId: string): Promise<Record<ConnectorName, boolean>> {
  if (ctx.config.mockConnectors) return { gmail: true, calendar: true, drive: true };
  const token = await ctx.store.getToken(userId, 'google');
  return token ? connectedFromScopes(token.scopes) : { gmail: false, calendar: false, drive: false };
}

export async function setMode(ctx: B1Context, userId: string, mode: Mode) {
  const state = await ctx.store.setUserState(userId, { mode });
  ctx.modeEvents.emit('mode', userId, mode);
  return state;
}
