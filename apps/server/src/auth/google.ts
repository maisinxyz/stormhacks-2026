// Google OAuth for Gmail / Calendar / Drive. Refresh tokens are stored encrypted (crypto.ts).
import { OAuth2Client } from 'google-auth-library';
import type { B1Config } from '../agent/config';
import type { B1Store } from '../agent/store';
import { decrypt, encrypt } from './crypto';

export const GOOGLE_SCOPES = {
  identity: ['openid', 'email', 'profile'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  // Full drive scope is needed to rename/move/share the user's existing files (drive.file only
  // covers files this app created). The OAuth app stays in test mode for the demo (PRD B1.7).
  drive: ['https://www.googleapis.com/auth/drive'],
};
export const ALL_SCOPES = Object.values(GOOGLE_SCOPES).flat();

export type ConnectorName = 'gmail' | 'calendar' | 'drive';
export const CONNECTOR_NAMES: ConnectorName[] = ['gmail', 'calendar', 'drive'];

export const googleConfigured = (c: B1Config) => Boolean(c.google.clientId && c.google.clientSecret);

export function oauthClient(c: B1Config) {
  if (!googleConfigured(c)) throw Object.assign(new Error('Google OAuth is not configured'), { code: 'oauth_not_configured' });
  return new OAuth2Client({ clientId: c.google.clientId, clientSecret: c.google.clientSecret, redirectUri: c.google.redirectUri });
}

export function authUrl(c: B1Config, state: string) {
  return oauthClient(c).generateAuthUrl({
    access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: ALL_SCOPES, state,
  });
}

/** Exchanges the code, stores the encrypted refresh token, returns the Google identity. */
export async function completeOAuth(c: B1Config, store: B1Store, key: Buffer, userId: string, code: string) {
  const client = oauthClient(c);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw Object.assign(new Error('Google did not return a refresh token'), { code: 'no_refresh_token' });
  let email: string | undefined; let name: string | undefined;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: c.google.clientId });
    email = ticket.getPayload()?.email; name = ticket.getPayload()?.name;
  }
  await store.putToken({
    userId, provider: 'google', email,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    encRefreshToken: encrypt(tokens.refresh_token, key),
    updatedAt: new Date().toISOString(),
  });
  return { email, name };
}

/** An authorized client for the user, or undefined if they have not connected Google. */
export async function userGoogleClient(c: B1Config, store: B1Store, key: Buffer, userId: string) {
  const token = await store.getToken(userId, 'google');
  if (!token || !googleConfigured(c)) return undefined;
  const client = oauthClient(c);
  client.setCredentials({ refresh_token: decrypt(token.encRefreshToken, key) });
  return { client, scopes: token.scopes, email: token.email };
}

export async function revokeGoogle(c: B1Config, store: B1Store, key: Buffer, userId: string) {
  const token = await store.getToken(userId, 'google');
  if (!token) return;
  try { if (googleConfigured(c)) await oauthClient(c).revokeToken(decrypt(token.encRefreshToken, key)); }
  catch { /* already revoked or network issue; local delete still disconnects */ }
  await store.deleteToken(userId, 'google');
}

export function connectedFromScopes(scopes: string[]): Record<ConnectorName, boolean> {
  const has = (list: string[]) => list.every(s => scopes.includes(s));
  return { gmail: has(GOOGLE_SCOPES.gmail), calendar: has(GOOGLE_SCOPES.calendar), drive: has(GOOGLE_SCOPES.drive) };
}
