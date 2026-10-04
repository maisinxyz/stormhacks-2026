import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { buildFetchApp } from '../src/integrated.js';
import { readConfig } from '../src/config.js';
import { mockBrain } from '../src/agent/mockBrain.js';
import type { Brain } from '../src/agent/brain.js';
import { mockWorkspace } from '../src/connectors/mock.js';
import { generatePet } from '../../web/src/engine/pipeline/generate.js';

async function setup(t: import('node:test').TestContext, options: { strict?: boolean; brain?: Brain } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fetch-integrated-'));
  const config = readConfig({ NODE_ENV: 'test', DATA_DIR: dir, DEV_AUTH: '0', MOCK_GEN: '1', MOCK_VOICE: '1' });
  const userId = `integration-${randomUUID()}`;
  const server = await buildFetchApp({ config, logger: false, b1: {
    config: { mockAgent: true, mockConnectors: true, demoUserId: userId, requireLogin: !!options.strict, sessionSecret: 'integration-private-session-secret' },
    brain: options.brain ?? mockBrain(0), notify: { mockArrivalMs: 0 }
  } });
  t.after(async () => {
    await server.app.close(); const target = resolve(dir);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('fetch-integrated-'));
    await rm(target, { recursive: true, force: true });
  });
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#f0c060' } }).png().toBuffer();
  async function pet(cookie?: string) {
    const f = new FormData();
    for (const [field, file] of [['splat', 'pet.splat'], ['rig', 'rig.json'], ['weights', 'weights.bin']] as const) {
      const bytes = await readFile(join(config.bundleDir, 'dog', file)); f.append(field, new Blob([new Uint8Array(bytes)]), file);
    }
    f.append('thumbnail', new Blob([new Uint8Array(png)]), 'thumbnail.png'); f.append('metadata', JSON.stringify({ name: 'Fetch dog', species: 'dog' }));
    const req = new Request('http://localhost/pets', { method: 'POST', body: f });
    const response = await server.app.inject({ method: 'POST', url: '/pets', headers: { 'content-type': req.headers.get('content-type')!, ...(cookie ? { cookie } : {}) }, payload: Buffer.from(await req.arrayBuffer()) });
    assert.equal(response.statusCode, 201, response.body); return response.json();
  }
  async function userCookie(id: string) {
    await server.b1.ctx.store.upsertUser({ id, name: id, createdAt: new Date().toISOString() });
    return `fetch_uid=${server.app.signCookie(id)}`;
  }
  return { ...server, config, userId, pet, userCookie };
}
async function eventsUntil(server: Awaited<ReturnType<typeof setup>>, runId: string, type: string) {
  for (let i = 0; i < 500; i++) {
    const events = (await server.b1.ctx.store.listEvents(runId, 0)).map(e => e.event);
    if (events.some(e => e.type === type)) return events;
    await delay(10);
  }
  throw new Error(`No ${type} event received`);
}

test('B1 session and B2 media share signed-cookie auth, and pet ownership is enforced on agent runs', async t => {
  const a = await setup(t, { strict: true });
  assert.equal((await a.app.inject({ url: '/session' })).statusCode, 401);
  assert.equal((await a.app.inject({ url: '/pets' })).statusCode, 401);
  const alice = await a.userCookie('alice'); const bob = await a.userCookie('bob');
  assert.equal((await a.app.inject({ url: '/session', headers: { cookie: alice } })).json().user.id, 'alice');
  const p = await a.pet(alice); assert.equal(a.context.storage.get(new URL(p.splatUrl).pathname.split('/').at(-1)!).user_id, 'alice');
  assert.equal((await a.app.inject({ url: `/pets/${p.id}`, headers: { cookie: bob } })).statusCode, 404);
  const denied = await a.app.inject({ method: 'POST', url: '/agent/run', headers: { cookie: bob }, payload: { petId: p.id, text: 'find my budget sheet' } });
  assert.equal(denied.statusCode, 404, denied.body);
  const own = await a.app.inject({ method: 'POST', url: '/agent/run', headers: { cookie: alice }, payload: { petId: p.id, text: 'find my budget sheet' } });
  assert.equal(own.statusCode, 200, own.body); const events = await eventsUntil(a, own.json().runId, 'run.result');
  assert.ok(events.some(e => e.type === 'run.plan')); assert.ok(events.some(e => e.type === 'tool.end'));
});

test('combined server approvals block sends, then execute once; Play leaves media available', async t => {
  const a = await setup(t); const p = await a.pet(); const ws = mockWorkspace(a.userId);
  const start = await a.app.inject({ method: 'POST', url: '/agent/run', payload: { petId: p.id, text: 'email the standup notes to my team' } });
  assert.equal(start.statusCode, 200, start.body); const runId = start.json().runId;
  const events = await eventsUntil(a, runId, 'approval.required'); const approval = events.find(e => e.type === 'approval.required')!;
  assert.equal(approval.type, 'approval.required'); if (approval.type !== 'approval.required') throw new Error();
  assert.equal(ws.sent.length, 0);
  assert.equal((await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, payload: { actionId: approval.actionId, contentHash: 'tampered' } })).statusCode, 409);
  const payload = { actionId: approval.actionId, contentHash: approval.contentHash };
  assert.equal((await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, payload })).statusCode, 200);
  await eventsUntil(a, runId, 'run.result'); assert.equal(ws.sent.length, 1);
  assert.equal((await a.app.inject({ method: 'POST', url: `/agent/runs/${runId}/approve`, payload })).statusCode, 200); assert.equal(ws.sent.length, 1);
  assert.equal((await a.app.inject({ method: 'POST', url: '/mode', payload: { mode: 'play' } })).statusCode, 200);
  assert.equal((await a.app.inject({ method: 'POST', url: '/agent/run', payload: { petId: p.id, text: 'find files' } })).statusCode, 403);
  assert.equal((await a.app.inject({ method: 'POST', url: '/agent/run', payload: { petId: 'unknown-pet', text: 'find files' } })).statusCode, 403);
  assert.equal((await a.app.inject({ url: '/pets' })).statusCode, 200);
  assert.equal((await a.app.inject({ method: 'POST', url: '/voice/tts', payload: { text: 'Play time!' } })).statusCode, 200);
});

test('background B1 prop generation retains the correct user for B2 cache ownership', async t => {
  const brain: Brain = () => {
    let turn = 0;
    return { async next() { return turn++ === 0 ? { calls: [{ id: 'plan1', name: 'plan', input: { steps: [{ verb: 'SEARCH', label: 'Searching', prop: 'tiny unicorn sticker' }] } }] } : { calls: [{ id: 'finish1', name: 'finish', input: { summary: 'Done', prop: 'tiny unicorn sticker' } }] }; } };
  };
  const a = await setup(t, { strict: true, brain }); const cookie = await a.userCookie('prop-user'); const p = await a.pet(cookie);
  const start = await a.app.inject({ method: 'POST', url: '/agent/run', headers: { cookie }, payload: { petId: p.id, text: 'look for a unicorn' } });
  assert.equal(start.statusCode, 200, start.body); await eventsUntil(a, start.json().runId, 'run.result');
  const rows = a.context.db.prepare('SELECT user_id FROM props_cache').all(); assert.ok(rows.length > 0); assert.ok(rows.every(r => r.user_id === 'prop-user'));
});

test('current F1 photo and drawing pipelines complete against the combined HTTP backend', async t => {
  const a = await setup(t);
  const base = await a.app.listen({ host: '127.0.0.1', port: 0 }); a.config.PUBLIC_URL = base;
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#f0c060' } }).png().toBuffer();
  for (const input of [{ species: 'dog', kind: 'photo' }, { species: 'bird', kind: 'drawing' }] as const) {
    const stages: string[] = [];
    const pet = await generatePet(base, { ...input, name: `F1 ${input.species}`, image: new Blob([new Uint8Array(png)]) }, progress => stages.push(progress.stage));
    assert.equal(pet.species, input.species); assert.ok(!stages.includes('fallback')); assert.ok(stages.includes('rig')); assert.ok(stages.includes('save'));
    assert.equal((await fetch(pet.splatUrl)).status, 200);
    assert.equal((await a.context.pets.get(pet.id)).name, `F1 ${input.species}`);
  }
});
