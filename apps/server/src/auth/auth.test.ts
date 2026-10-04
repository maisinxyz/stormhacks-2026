import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildB1App } from '../agent/testApp';
import { decrypt, encrypt, resolveKey } from './crypto';

describe('crypto', () => {
  it('round-trips and rejects tampering', () => {
    const key = resolveKey(randomBytes(32).toString('base64'), 'x');
    const blob = encrypt('refresh-token-123', key);
    expect(blob).not.toContain('refresh-token-123');
    expect(decrypt(blob, key)).toBe('refresh-token-123');
    const bad = Buffer.from(blob, 'base64'); bad[bad.length - 1] ^= 1;
    expect(() => decrypt(bad.toString('base64'), key)).toThrow();
  });
});

describe('requireUser + /session', () => {
  it('falls back to the demo user without a cookie', async () => {
    const { app } = await buildB1App({ config: { mockConnectors: true } });
    const res = await app.inject({ method: 'GET', url: '/session' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe('demo-user');
    expect(body.mode).toBe('work');
    expect(body.connected).toEqual({ gmail: true, calendar: true, drive: true });
  });

  it('rejects missing or forged cookies when REQUIRE_LOGIN is on', async () => {
    const { app } = await buildB1App({ config: { requireLogin: true } });
    expect((await app.inject({ method: 'GET', url: '/session' })).statusCode).toBe(401);
    const forged = await app.inject({ method: 'GET', url: '/session', cookies: { fetch_uid: 'someone-else' } });
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toEqual({ error: 'auth_required' });
  });

  it('accepts a correctly signed cookie for a known user', async () => {
    const { app, ctx } = await buildB1App({ config: { requireLogin: true } });
    await ctx.store.upsertUser({ id: 'u1', name: 'Ada', createdAt: new Date().toISOString() });
    const res = await app.inject({ method: 'GET', url: '/session', cookies: { fetch_uid: app.signCookie('u1') } });
    expect(res.statusCode).toBe(200);
    expect(res.json().userName).toBe('Ada');
  });

  it('reports connectors as disconnected without a Google token', async () => {
    const { app } = await buildB1App();
    expect((await app.inject({ method: 'GET', url: '/session' })).json().connected)
      .toEqual({ gmail: false, calendar: false, drive: false });
  });
});

describe('/mode', () => {
  it('is server-authoritative and validated', async () => {
    const { app } = await buildB1App();
    expect((await app.inject({ method: 'POST', url: '/mode', payload: { mode: 'party' } })).statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: '/mode', payload: { mode: 'play' } });
    expect(res.json()).toEqual({ mode: 'play' });
    expect((await app.inject({ method: 'GET', url: '/session' })).json().mode).toBe('play');
  });
});

describe('/connectors and OAuth', () => {
  it('disconnect deletes the stored token', async () => {
    const { app, ctx } = await buildB1App();
    await ctx.store.putToken({
      userId: 'demo-user', provider: 'google', scopes: [], encRefreshToken: encrypt('t', ctx.tokenKey), updatedAt: '',
    });
    expect((await app.inject({ method: 'DELETE', url: '/connectors/nope' })).statusCode).toBe(404);
    const res = await app.inject({ method: 'DELETE', url: '/connectors/gmail' });
    expect(res.statusCode).toBe(200);
    expect(await ctx.store.getToken('demo-user', 'google')).toBeUndefined();
  });

  it('start redirects to Google with a state cookie when configured', async () => {
    const { app } = await buildB1App({ config: { google: { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost/cb' } } });
    const res = await app.inject({ method: 'GET', url: '/auth/google/start' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(res.headers.location).toContain('access_type=offline');
    expect(String(res.headers['set-cookie'])).toContain('fetch_oauth_state');
  });

  it('callback rejects a mismatched state', async () => {
    const { app } = await buildB1App({ config: { google: { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost/cb' } } });
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=x&state=forged' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('connect_error=invalid_state');
  });
});
