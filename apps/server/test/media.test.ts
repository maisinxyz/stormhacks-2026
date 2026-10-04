import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { mockPly } from '../src/media/mock.js';
import { normalizePly, validatePly } from '../src/media/service.js';
import { Providers, spaceHost, type Gradio } from '../src/media/providers.js';
import { parsePly } from '../../web/src/engine/pipeline/gaussians.js';
import { UserWork } from '../src/media/user-work.js';

async function fixture(t: import('node:test').TestContext, overrides: NodeJS.ProcessEnv = {}, fetcher?: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'fetch-b2-'));
  const config = readConfig({ NODE_ENV: 'test', DEV_AUTH: '1', MOCK_GEN: '1', MOCK_VOICE: '1', DATA_DIR: dir, ASSET_SIGNING_SECRET: 'test-signing-secret-longer-than-32-chars', ...overrides });
  const server = await buildApp({ config, logger: false, fetcher, requireUser: async req => { req.user = { id: String(req.headers['x-test-user'] ?? 'alice'), name: 'Test User', createdAt: new Date().toISOString() }; } });
  const closeLater: (() => Promise<unknown>)[] = [];
  t.after(async () => {
    await server.app.close();
    for (const close of closeLater) await close();
    const target = resolve(dir);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('fetch-b2-'));
    await rm(target, { recursive: true, force: true });
  });
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#f0c060' } }).png().toBuffer();
  async function form(path: string, values: Record<string, string | Buffer>, headers: Record<string, string> = {}) {
    const f = new FormData();
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'string') f.append(name, value);
      else f.append(name, new Blob([new Uint8Array(value)]), name);
    }
    const r = new Request('http://localhost' + path, { method: 'POST', body: f });
    return server.app.inject({ method: 'POST', url: path, headers: { 'content-type': r.headers.get('content-type')!, ...headers }, payload: Buffer.from(await r.arrayBuffer()) });
  }
  return { ...server, config, png, form, closeLater };
}
function bundle(png: Buffer) {
  const splat = Buffer.alloc(64), weights = Buffer.alloc(16);
  for (let i = 0; i < 2; i++) { for (let j = 3; j < 6; j++) splat.writeFloatLE(.05, i * 32 + j * 4); splat.fill(255, i * 32 + 24, i * 32 + 28); splat[i * 32 + 28] = 255; weights[i * 8 + 4] = 255; }
  return { splat, weights, rig: Buffer.from(JSON.stringify({ template: 'quadruped', bones: [{ name: 'root', parent: -1, head: [0, 0, 0], tail: [0, 1, 0] }] })), thumbnail: png, metadata: JSON.stringify({ name: 'Buddy', species: 'dog' }) };
}

test('pet persistence, isolated access, signed ranges/compression, patch, and asset deletion', async t => {
  const { app, context, png, form } = await fixture(t);
  const create = await form('/pets', bundle(png)); assert.equal(create.statusCode, 201, create.body);
  const pet = create.json(); assert.equal(pet.name, 'Buddy'); assert.equal(pet.stats.energy, 100);
  assert.equal((await context.pets.get(pet.id)).species, 'dog');
  const assetPath = new URL(pet.splatUrl).pathname + new URL(pet.splatUrl).search;
  const range = await app.inject({ url: assetPath, headers: { range: 'bytes=0-31' } }); assert.equal(range.statusCode, 206); assert.equal(range.rawPayload.length, 32);
  const suffix = await app.inject({ url: assetPath, headers: { range: 'bytes=-8' } }); assert.equal(suffix.statusCode, 206); assert.equal(suffix.rawPayload.length, 8);
  assert.equal((await app.inject({ url: assetPath, headers: { range: 'bytes=1000-' } })).statusCode, 416);
  const gzip = await app.inject({ url: assetPath, headers: { 'accept-encoding': 'gzip' } }); assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal((await app.inject({ url: new URL(pet.splatUrl).pathname })).statusCode, 422);
  const tampered = assetPath.replace(/signature=[^&]+/, 'signature=' + '0'.repeat(64)); assert.equal((await app.inject({ url: tampered })).statusCode, 403);
  assert.equal((await app.inject({ url: `/pets/${pet.id}`, headers: { 'x-test-user': 'bob' } })).statusCode, 404);
  const patch = await app.inject({ method: 'PATCH', url: `/pets/${pet.id}`, payload: { stats: { happiness: 99 }, personality: { sassy: .8 }, name: 'Scout' } });
  assert.equal(patch.statusCode, 200, patch.body); assert.equal(patch.json().stats.energy, 100); assert.equal(patch.json().stats.happiness, 99);
  assert.equal((await app.inject({ method: 'PATCH', url: `/pets/${pet.id}`, payload: { stats: { hunger: -1 } } })).statusCode, 422);
  assert.equal((await app.inject({ url: '/pets' })).json().length, 1);
  assert.equal((await app.inject({ method: 'DELETE', url: `/pets/${pet.id}` })).statusCode, 204);
  assert.equal((await app.inject({ url: assetPath })).statusCode, 404);
  assert.equal(context.db.prepare('SELECT * FROM pet_stats').all().length, 0);
});

test('F1 upload/reference/segment/job mock flow returns real Gaussian PLY for dog and bird', async t => {
  const { app, png, form } = await fixture(t);
  const upload = await form('/uploads', { image: png }); assert.equal(upload.statusCode, 200, upload.body); const { imageId } = upload.json();
  const seg = await form('/gen/segment', { image: png }); assert.equal(seg.statusCode, 200); assert.match(String(seg.headers['content-type']), /image\/png/);
  assert.equal((await app.inject({ method: 'POST', url: '/gen/reference', payload: { imageId, species: 'bird' } })).json().imageId, imageId);
  for (const species of ['dog', 'bird']) {
    const start = await app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId], species } }); assert.equal(start.statusCode, 200, start.body);
    const jobPath = `/gen/jobs/${start.json().jobId}`;
    assert.equal((await app.inject({ url: jobPath, headers: { 'x-test-user': 'bob' } })).statusCode, 404);
    const job = await app.inject({ url: jobPath }); assert.equal(job.json().status, 'done', job.body);
    const url = new URL(job.json().splatUrl); const ply = await app.inject({ url: url.pathname + url.search }); validatePly(ply.rawPayload);
    const cloud = parsePly(new Uint8Array(ply.rawPayload).buffer);
    assert.ok(cloud.n >= 2000); assert.ok(cloud.pos.every(Number.isFinite));
    assert.equal((await app.inject({ url: jobPath })).json().status, 'done');
  }
  assert.equal((await app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId, imageId], species: 'dog' } })).statusCode, 422);
  assert.equal((await app.inject({ method: 'POST', url: '/gen/image-to-3d', headers: { 'x-test-user': 'bob' }, payload: { imageIds: [imageId], species: 'dog' } })).statusCode, 404);
});

test('mock voice, SFX and prop caches, bad uploads, delete-my-media, and CORS', async t => {
  const { app, context, png, form } = await fixture(t);
  const voice = await app.inject({ method: 'POST', url: '/voice/design', payload: { species: 'bird' } }); assert.equal(voice.json().voiceId, 'mock-bird');
  const speech = await app.inject({ method: 'POST', url: '/voice/tts', payload: { text: 'Hello!', species: 'bird', voiceId: 'mock-bird' } });
  assert.equal(speech.statusCode, 200, speech.body); assert.equal(speech.rawPayload.subarray(0, 4).toString(), 'RIFF'); assert.equal(speech.headers['x-fetch-mock-voice'], 'true');
  assert.equal((await app.inject({ url: '/voice/stt-token' })).statusCode, 503);
  for (const path of ['/voice/sfx', '/gen/prop']) {
    const a = await app.inject({ method: 'POST', url: path, payload: { prompt: '  Tiny   envelope ' } }); assert.equal(a.statusCode, 200, a.body);
    const b = await app.inject({ method: 'POST', url: path, payload: { prompt: 'tiny envelope' } });
    assert.equal(new URL(Object.values(a.json())[0] as string).pathname, new URL(Object.values(b.json())[0] as string).pathname);
  }
  const prop = await context.forUser('alice').media.generateProp('a phone'); assert.match(prop.imageUrl, /\/assets\//);
  assert.equal((await form('/uploads', { image: Buffer.from('not an image') })).statusCode, 422);
  assert.equal((await form('/pets', { ...bundle(png), weights: Buffer.alloc(1) })).statusCode, 422);
  assert.equal((await app.inject({ url: '/health', headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/health', headers: { origin: 'http://localhost:5173' } })).headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal((await app.inject({ method: 'DELETE', url: '/pets' })).statusCode, 204);
  assert.equal(context.db.prepare('SELECT * FROM assets').all().length, 0);
  assert.equal(context.db.prepare('SELECT * FROM media_cache').all().length, 0);
  assert.equal(context.db.prepare('SELECT * FROM props_cache').all().length, 0);
  assert.equal(context.db.prepare('SELECT * FROM voices').all().length, 0);
});

test('real provider adapter uses Gaussian output, server-only credentials, and streamed ElevenLabs responses', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  let rawPly: Buffer;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === 'https://api.replicate.com/v1/predictions') return Response.json({ id: 'test-prediction' });
    if (url.endsWith('/test-prediction')) return Response.json({ status: 'succeeded', output: { gaussian_ply: 'https://replicate.delivery/test/output.ply' } });
    if (url.startsWith('https://replicate.delivery/')) return new Response(new Uint8Array(rawPly));
    if (url.endsWith('/text-to-voice/design')) return Response.json({ previews: [{ generated_voice_id: 'preview-1' }] });
    if (url.endsWith('/text-to-voice')) return Response.json({ voice_id: 'created-voice' });
    if (url.includes('/text-to-speech/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    if (url.includes('single-use-token')) return Response.json({ token: 'short-lived-token' });
    throw new Error(`Unexpected URL ${url}`);
  };
  const { app, config, png, form } = await fixture(t, { MOCK_GEN: '0', MOCK_VOICE: '0', REPLICATE_API_TOKEN: 'private-replicate-key', ELEVENLABS_API_KEY: 'private-eleven-key' }, fetcher);
  rawPly = await mockPly(config.bundleDir, 'dog');
  const imageId = (await form('/uploads', { image: png })).json().imageId;
  const start = await app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId, imageId, imageId], species: 'dog' } });
  assert.equal(start.statusCode, 200, start.body);
  const sent = JSON.parse(String(calls[0].init.body)); assert.equal(sent.input.save_gaussian_ply, true); assert.equal(sent.input.images.length, 3); assert.equal(sent.input.generate_model, false);
  const job = await app.inject({ url: `/gen/jobs/${start.json().jobId}` }); assert.equal(job.json().status, 'done', job.body); assert.ok(!job.body.includes('private-'));
  const voice = await app.inject({ method: 'POST', url: '/voice/design', payload: { species: 'dog', description: 'A scruffy terrier' } }); assert.equal(voice.json().voiceId, 'created-voice', voice.body);
  const speech = await app.inject({ method: 'POST', url: '/voice/tts', payload: { text: 'Hello!', voiceId: voice.json().voiceId } }); assert.equal(speech.statusCode, 200, speech.body); assert.deepEqual([...speech.rawPayload], [1, 2, 3]);
  assert.equal((await app.inject({ method: 'POST', url: '/voice/tts', headers: { 'x-test-user': 'bob' }, payload: { text: 'Hello!', voiceId: 'created-voice' } })).statusCode, 404);
  assert.equal((await app.inject({ url: '/voice/stt-token' })).json().token, 'short-lived-token');
});

test('production fails closed without B1 auth and refuses dev auth', async () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production', DEV_AUTH: '1', ASSET_SIGNING_SECRET: 'x'.repeat(32) }), /Production/);
  await assert.rejects(buildApp({ config: readConfig({ NODE_ENV: 'production', ASSET_SIGNING_SECRET: 'x'.repeat(32) }), logger: false }), /B1 requireUser/);
});

test('user deletion waits for active work and blocks new writes', async () => {
  const work = new UserWork(); const release = work.enter('alice'); let deleted = false;
  const deletion = work.delete('alice', async () => { deleted = true; });
  assert.equal(deleted, false); assert.throws(() => work.enter('alice'), /deletion/);
  const other = work.enter('bob'); other(); release(); await deletion;
  assert.equal(deleted, true); work.enter('alice')();
});

test('shutdown drains background user media work before closing persistence', async () => {
  const work = new UserWork(); const release = work.enter('alice'); let closed = false;
  const closing = work.close().then(() => { closed = true; });
  assert.equal(closed, false); assert.throws(() => work.enter('bob'), /server_closing/);
  release(); await closing; assert.equal(closed, true);
});

test('shutdown also waits for ongoing data deletion to finish', async () => {
  const work = new UserWork(); let finish!: () => void; let closed = false;
  const deletion = work.delete('alice', () => new Promise<void>(resolve => { finish = resolve; }));
  const closing = work.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  finish(); await deletion; await closing; assert.equal(closed, true);
});

test('SQLite pets and signing persist across a restart', async t => {
  const { app, config, png, form, closeLater } = await fixture(t);
  const pet = (await form('/pets', bundle(png))).json();
  await app.close();
  const restarted = await buildApp({ config, logger: false, requireUser: async req => { req.user = { id: 'alice', name: 'Alice', createdAt: new Date().toISOString() }; } });
  closeLater.push(() => restarted.app.close());
  const loaded = await restarted.app.inject({ url: `/pets/${pet.id}` }); assert.equal(loaded.statusCode, 200, loaded.body); assert.equal(loaded.json().name, 'Buddy');
  const oldUrl = new URL(pet.splatUrl); assert.equal((await restarted.app.inject({ url: oldUrl.pathname + oldUrl.search })).statusCode, 200);
});

test('job timeout and invalid provider Gaussian output give clear terminal errors', async t => {
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('/predictions')) return Response.json({ id: 'bad-prediction' });
    return Response.json({ status: 'succeeded', output: { model_file: 'https://replicate.delivery/mesh.glb' } });
  };
  const { app, context, png, form } = await fixture(t, { MOCK_GEN: '0', REPLICATE_API_TOKEN: 'test-key' }, fetcher);
  const imageId = (await form('/uploads', { image: png })).json().imageId;
  const payload = { imageIds: [imageId], species: 'dog' };
  const first = (await app.inject({ method: 'POST', url: '/gen/image-to-3d', payload })).json();
  assert.equal((await app.inject({ url: `/gen/jobs/${first.jobId}` })).json().error, 'gen_low_quality');
  const second = (await app.inject({ method: 'POST', url: '/gen/image-to-3d', payload })).json();
  context.db.prepare('UPDATE gen_jobs SET created_at=? WHERE id=?').run(0, second.jobId);
  assert.equal((await app.inject({ url: `/gen/jobs/${second.jobId}` })).json().error, 'gen_timeout');
});

test('route rate limits preserve HTTP 429 and the client error code', async t => {
  const { app } = await fixture(t);
  for (let i = 0; i < 6; i++) assert.equal((await app.inject({ method: 'POST', url: '/voice/design', payload: { species: 'dog' } })).statusCode, 200);
  const limited = await app.inject({ method: 'POST', url: '/voice/design', payload: { species: 'dog' } });
  assert.equal(limited.statusCode, 429, limited.body); assert.equal(limited.json().code, 'rate_limited'); assert.ok(limited.headers['retry-after']);
});

test('malformed and oversized upstream responses produce provider errors, not HTTP 500', async t => {
  const fetcher: typeof fetch = async () => new Response('not JSON');
  const { app, config } = await fixture(t, { MOCK_VOICE: '0', ELEVENLABS_API_KEY: 'private-key' }, fetcher);
  const response = await app.inject({ method: 'POST', url: '/voice/design', payload: { species: 'dog' } });
  assert.equal(response.statusCode, 502, response.body); assert.equal(response.json().code, 'provider_failed');
  const providers = new Providers(config, fetcher);
  await assert.rejects(providers.bytes(new Response('12345'), 4), /size limit/);
  await assert.rejects(providers.download('https://localhost/private'), /asset host/);
  await assert.rejects(providers.download('https://replicate.delivery.evil.example/private'), /asset host/);
  await assert.rejects(providers.json(new Response('null')), /invalid JSON/);
});

test('fal drawing, segmentation, and prop adapters follow the queued provider schemas', async t => {
  const submitted: { model: string; input: any }[] = [];
  let png: Buffer;
  const fetcher: typeof fetch = async (request, init = {}) => {
    const url = String(request);
    if (url.startsWith('https://queue.fal.run/') && init.method === 'POST') {
      submitted.push({ model: url, input: JSON.parse(String(init.body)) });
      assert.equal((init.headers as Record<string, string>).Authorization, 'Key private-fal-key');
      return Response.json({ status_url: `${url}/requests/123/status`, response_url: `${url}/requests/123/response`, cancel_url: `${url}/requests/123/cancel` });
    }
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (url.endsWith('/response')) return Response.json(url.includes('/rembg/') ? { image: { url: 'https://fal.media/output.png' } } : { images: [{ url: 'https://fal.media/output.png' }] });
    if (url === 'https://fal.media/output.png') return new Response(new Uint8Array(png));
    throw new Error(`Unexpected provider URL ${url}`);
  };
  const a = await fixture(t, { MOCK_GEN: '0', FAL_KEY: 'private-fal-key' }, fetcher); png = a.png;
  const imageId = (await a.form('/uploads', { image: png })).json().imageId;
  const reference = await a.app.inject({ method: 'POST', url: '/gen/reference', payload: { imageId, species: 'bird' } });
  assert.equal(reference.statusCode, 200, reference.body); assert.notEqual(reference.json().imageId, imageId);
  assert.match(submitted[0].input.image_url, /^data:image\/png;base64,/);
  const segment = await a.form('/gen/segment', { image: png }); assert.equal(segment.statusCode, 200, segment.body);
  const prop = await a.app.inject({ method: 'POST', url: '/gen/prop', payload: { prompt: 'calendar sticker' } }); assert.equal(prop.statusCode, 200, prop.body);
  assert.deepEqual(submitted.map(s => new URL(s.model).pathname), ['/fal-ai/flux/dev/image-to-image', '/fal-ai/imageutils/rembg', '/fal-ai/flux/schnell', '/fal-ai/imageutils/rembg']);
});

test('Gaussian validation handles CRLF and rejects NaNs, wrong property types, and truncated bodies', async t => {
  const { config } = await fixture(t); const ply = await mockPly(config.bundleDir, 'dog');
  const start = ply.indexOf('end_header\n') + 11;
  const crlf = Buffer.concat([Buffer.from(ply.subarray(0, start).toString().replace(/\n/g, '\r\n')), ply.subarray(start)]);
  assert.deepEqual(normalizePly(crlf), ply); validatePly(normalizePly(crlf));
  const corrupt = Buffer.from(ply); corrupt.writeFloatLE(NaN, start); assert.throws(() => validatePly(corrupt), /gen_low_quality/);
  const wrongType = Buffer.concat([Buffer.from(ply.subarray(0, start).toString().replace('property float x', 'property uchar x')), ply.subarray(start)]);
  assert.throws(() => validatePly(wrongType), /gen_low_quality/);
  assert.throws(() => validatePly(ply.subarray(0, start + 10)), /gen_low_quality/);
});

test('compressed asset responses preserve CORS Vary and authentication errors fail closed', async t => {
  const { app, config, png, form, closeLater } = await fixture(t); const pet = (await form('/pets', bundle(png))).json(); const url = new URL(pet.splatUrl);
  const response = await app.inject({ url: url.pathname + url.search, headers: { origin: 'http://localhost:5173', 'accept-encoding': 'br' } });
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers['content-encoding'], 'br');
  assert.match(String(response.headers.vary), /Origin/i); assert.match(String(response.headers.vary), /Accept-Encoding/i);
  const unauthenticated = await buildApp({ config: readConfig({ NODE_ENV: 'test', DATA_DIR: join(config.DATA_DIR, 'auth-check') }), logger: false });
  closeLater.push(() => unauthenticated.app.close());
  assert.equal((await unauthenticated.app.inject({ url: '/pets' })).statusCode, 401);
});

test('browser preflights permit pet updates and deletion from the configured web origin', async t => {
  const { app } = await fixture(t);
  for (const method of ['PATCH', 'DELETE']) {
    const response = await app.inject({ method: 'OPTIONS', url: '/pets', headers: {
      origin: 'http://localhost:5173', 'access-control-request-method': method,
      'access-control-request-headers': 'content-type'
    } });
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
    assert.ok(String(response.headers['access-control-allow-methods']).split(/,\s*/).includes(method));
  }
});

test('temporary provider outages keep an existing prediction pollable until it recovers', async t => {
  let recovering = false; let rawPly: Buffer;
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('/predictions')) return Response.json({ id: 'recoverable-prediction' });
    if (url.endsWith('/recoverable-prediction')) return recovering
      ? Response.json({ status: 'succeeded', output: { gaussian_ply: 'https://replicate.delivery/recovered.ply' } })
      : new Response('Temporary outage', { status: 503 });
    if (url === 'https://replicate.delivery/recovered.ply') return new Response(new Uint8Array(rawPly));
    throw new Error(`Unexpected URL ${url}`);
  };
  const { app, config, png, form } = await fixture(t, { MOCK_GEN: '0', REPLICATE_API_TOKEN: 'test-key' }, fetcher);
  rawPly = await mockPly(config.bundleDir, 'dog');
  const imageId = (await form('/uploads', { image: png })).json().imageId;
  const start = await app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId], species: 'dog' } });
  const jobPath = `/gen/jobs/${start.json().jobId}`;
  assert.equal((await app.inject({ url: jobPath })).json().status, 'pending');
  recovering = true;
  assert.equal((await app.inject({ url: jobPath })).json().status, 'done');
});

const SPACE_FILES = 'https://trellis-community-trellis.hf.space/gradio_api/file=/tmp/gradio/';
const QUOTA = 'You have exceeded your ZeroGPU quota (120s requested vs. 157s left). Try again in 23:53:46. Authenticate with a Hugging Face token for more quota - https://huggingface.co/settings/tokens';
/** TRELLIS Space layout: x,y,z,nx,ny,nz,f_dc_0..2,opacity,scale_0..2,rot_0..3. */
function trellisPly(n = 2000) {
  const names = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n${names.map(p => `property float ${p}\n`).join('')}end_header\n`);
  const data = Buffer.alloc(n * names.length * 4);
  for (let i = 0; i < n; i++) {
    const o = i * names.length * 4;
    for (let k = 0; k < 3; k++) data.writeFloatLE(Math.sin(i * (k + 1)) * .5, o + k * 4);
    for (let k = 10; k < 13; k++) data.writeFloatLE(-4, o + k * 4);
    data.writeFloatLE(1, o + 13 * 4);
  }
  return Buffer.concat([header, data]);
}
/** Fake @gradio/client: each endpoint handler returns the prediction's data array. */
function fakeGradio(handlers: Record<string, (data: any) => unknown[] | Promise<unknown[]>> = {}, expectedSpace = 'trellis-community/TRELLIS') {
  const calls: { endpoint: string; data: any }[] = []; let connects = 0;
  const gradio: Gradio = {
    handle_file: blob => ({ blob }),
    Client: { connect: async space => {
      assert.equal(space, expectedSpace); connects++;
      return { predict: async (endpoint, data) => { calls.push({ endpoint, data }); return { data: await (handlers[endpoint] ?? (() => []))(data) }; }, close() {} };
    } }
  };
  return { gradio, calls, connects: () => connects };
}
const spaceFetcher = (png: () => Buffer, ply: Buffer = trellisPly()): typeof fetch => async input => {
  const url = String(input);
  if (url === `${SPACE_FILES}pre.png`) return new Response(new Uint8Array(png()));
  if (url === `${SPACE_FILES}sample.ply`) return new Response(new Uint8Array(ply));
  throw new Error(`Unexpected URL ${url}`);
};
const spaceHandlers = { '/preprocess_image': () => [{ url: `${SPACE_FILES}pre.png`, path: '/tmp/gradio/pre.png' }], '/extract_gaussian': () => [{ url: `${SPACE_FILES}sample.ply` }, `${SPACE_FILES}sample.ply`] };
async function settle(app: import('fastify').FastifyInstance, path: string) {
  for (let i = 0; i < 300; i++) {
    const r = (await app.inject({ url: path })).json();
    if (r.status !== 'pending') return r;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job stayed pending');
}

test('image-to-3d provider defaults to the free HF Space unless Replicate is configured', () => {
  assert.equal(readConfig({}).IMAGE_TO_3D_PROVIDER, 'hf');
  assert.equal(readConfig({ REPLICATE_API_TOKEN: 'r8' }).IMAGE_TO_3D_PROVIDER, 'replicate');
  assert.equal(readConfig({ REPLICATE_API_TOKEN: 'r8', IMAGE_TO_3D_PROVIDER: 'hf' }).IMAGE_TO_3D_PROVIDER, 'hf');
  assert.equal(readConfig({}).GEN_TIMEOUT_MS, 300000);
  assert.equal(spaceHost('trellis-community/TRELLIS'), 'trellis-community-trellis.hf.space');
  assert.throws(() => readConfig({ HF_TRELLIS_SPACE: 'https://evil.example' }));
});

test('free HF TRELLIS jobs run in the background and store a validated Gaussian PLY (1 and 3 images)', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let png!: Buffer;
  const fake = fakeGradio({ ...spaceHandlers, '/generate_and_extract_glb': async () => { await gate; return [{}, {}, {}]; } });
  const f = await fixture(t, { MOCK_GEN: '0' }, spaceFetcher(() => png)); png = f.png;
  f.context.media.providers.gradio = fake.gradio;
  const imageId = (await f.form('/uploads', { image: png })).json().imageId;
  const start = await f.app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId], species: 'cat' } });
  assert.equal(start.statusCode, 200, start.body);
  const jobPath = `/gen/jobs/${start.json().jobId}`;
  assert.deepEqual((await f.app.inject({ url: jobPath })).json(), { status: 'pending' });
  release();
  const done = await settle(f.app, jobPath); assert.equal(done.status, 'done', JSON.stringify(done));
  assert.deepEqual(fake.calls.map(c => c.endpoint), ['/start_session', '/preprocess_image', '/generate_and_extract_glb', '/extract_gaussian']);
  const gen = fake.calls[2].data; assert.deepEqual(gen.multiimages, []); assert.equal(gen.ss_sampling_steps, 12); assert.ok(gen.image.blob instanceof Blob);
  const url = new URL(done.splatUrl); const ply = await f.app.inject({ url: url.pathname + url.search });
  validatePly(ply.rawPayload); assert.equal(parsePly(new Uint8Array(ply.rawPayload).buffer).n, 2000);
  fake.calls.length = 0;
  const multi = await f.app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId, imageId, imageId], species: 'dog' } });
  assert.equal((await settle(f.app, `/gen/jobs/${multi.json().jobId}`)).status, 'done');
  assert.deepEqual(fake.calls.map(c => c.endpoint), ['/start_session', '/preprocess_image', '/preprocess_image', '/preprocess_image', '/lambda_1', '/generate_and_extract_glb', '/extract_gaussian']);
  assert.equal(fake.calls[5].data.multiimages.length, 3); assert.equal(fake.connects(), 2);
});

test('HF ZeroGPU quota fails the job with gen_quota and retryAfter, and segment answers 429 without calling the Space', async t => {
  const fake = fakeGradio({ ...spaceHandlers, '/generate_and_extract_glb': () => { throw { type: 'status', stage: 'error', message: QUOTA }; } });
  let png!: Buffer;
  const f = await fixture(t, { MOCK_GEN: '0' }, spaceFetcher(() => png)); png = f.png;
  f.context.media.providers.gradio = fake.gradio;
  const imageId = (await f.form('/uploads', { image: png })).json().imageId;
  const start = await f.app.inject({ method: 'POST', url: '/gen/image-to-3d', payload: { imageIds: [imageId], species: 'dog' } });
  const failed = await settle(f.app, `/gen/jobs/${start.json().jobId}`);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'gen_quota');
  assert.ok(failed.retryAfter > 23 * 3600 && failed.retryAfter <= 23 * 3600 + 53 * 60 + 46, JSON.stringify(failed));
  const before = fake.calls.length;
  const seg = await f.form('/gen/segment', { image: png });
  assert.equal(seg.statusCode, 429, seg.body); assert.equal(seg.json().code, 'gen_quota'); assert.ok(Number(seg.headers['retry-after']) > 0);
  assert.equal(fake.calls.length, before);
});

test('HF runs time out as gen_timeout, and a pending HF job orphaned by a restart becomes gen_interrupted', async t => {
  const fake = fakeGradio({ ...spaceHandlers, '/generate_and_extract_glb': () => new Promise(() => {}) });
  let png!: Buffer;
  const f = await fixture(t, { MOCK_GEN: '0', GEN_TIMEOUT_MS: '1000' }, spaceFetcher(() => png)); png = f.png;
  f.context.media.providers.gradio = fake.gradio;
  const imageId = (await f.form('/uploads', { image: png })).json().imageId;
  const payload = { imageIds: [imageId], species: 'dog' };
  const timed = (await f.app.inject({ method: 'POST', url: '/gen/image-to-3d', payload })).json();
  assert.equal((await settle(f.app, `/gen/jobs/${timed.jobId}`)).error, 'gen_timeout');
  const orphan = (await f.app.inject({ method: 'POST', url: '/gen/image-to-3d', payload })).json();
  assert.equal((await f.app.inject({ url: `/gen/jobs/${orphan.jobId}` })).json().status, 'pending');
  await f.app.close();
  const restarted = await buildApp({ config: f.config, logger: false, requireUser: async req => { req.user = { id: 'alice', name: 'Alice', createdAt: new Date().toISOString() }; } });
  f.closeLater.push(() => restarted.app.close());
  assert.deepEqual((await restarted.app.inject({ url: `/gen/jobs/${orphan.jobId}` })).json(), { status: 'failed', error: 'gen_interrupted' });
});

test('segment uses the free Space background removal without FAL_KEY and only downloads from the Space host', async t => {
  let png!: Buffer; let host = SPACE_FILES;
  const fake = fakeGradio({ '/preprocess_image': () => [{ url: `${host}pre.png` }] });
  const f = await fixture(t, { MOCK_GEN: '0' }, spaceFetcher(() => png)); png = f.png;
  f.context.media.providers.gradio = fake.gradio;
  const seg = await f.form('/gen/segment', { image: png });
  assert.equal(seg.statusCode, 200, seg.body); assert.match(String(seg.headers['content-type']), /image\/png/);
  assert.equal((await sharp(seg.rawPayload).metadata()).format, 'png');
  assert.deepEqual(fake.calls.map(c => c.endpoint), ['/preprocess_image']);
  host = 'https://evil-space.hf.space/gradio_api/file=';
  assert.equal((await f.form('/gen/segment', { image: png })).statusCode, 502);
  const providers = new Providers(f.config);
  for (const url of ['https://trellis-community-trellis.hf.space.evil.example/x.ply', 'https://replicate.delivery/x.ply', 'http://trellis-community-trellis.hf.space/x.ply']) {
    await assert.rejects(providers.download(url, 1024, spaceHost(f.config.HF_TRELLIS_SPACE)), /asset host/);
  }
});

const EDIT_SPACE = 'black-forest-labs/FLUX.1-Kontext-Dev';
const EDIT_FILES = 'https://black-forest-labs-flux-1-kontext-dev.hf.space/gradio_api/file=/tmp/gradio/';
async function editFixture(t: import('node:test').TestContext, infer: (data: any) => unknown[] | Promise<unknown[]>) {
  const edited = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#8b5a2b' } }).webp().toBuffer();
  const fetched: string[] = [];
  const f = await fixture(t, { MOCK_GEN: '0' }, async input => {
    const url = String(input); fetched.push(url);
    if (url === `${EDIT_FILES}out.webp`) return new Response(new Uint8Array(edited));
    throw new Error(`Unexpected URL ${url}`);
  });
  const fake = fakeGradio({ '/infer': infer }, EDIT_SPACE);
  f.context.media.providers.gradio = fake.gradio;
  const imageId = (await f.form('/uploads', { image: f.png })).json().imageId;
  return { ...f, fake, fetched, imageId };
}

test('reference uses the free Kontext Space without FAL_KEY: drawing and photo prompts, stored as a new PNG', async t => {
  const f = await editFixture(t, () => [{ url: `${EDIT_FILES}out.webp`, path: '/tmp/gradio/out.webp' }, 0]);
  assert.equal(readConfig({}).HF_EDIT_SPACE, EDIT_SPACE);
  const drawing = await f.app.inject({ method: 'POST', url: '/gen/reference', payload: { imageId: f.imageId, species: 'dog' } });
  assert.equal(drawing.statusCode, 200, drawing.body); assert.notEqual(drawing.json().imageId, f.imageId);
  const stored = await f.context.storage.read(drawing.json().imageId, 'alice');
  const meta = await sharp(stored).metadata(); assert.equal(meta.format, 'png'); assert.deepEqual([meta.width, meta.height], [40, 30]);
  const photo = await f.app.inject({ method: 'POST', url: '/gen/reference', payload: { imageId: f.imageId, species: 'cat', kind: 'photo' } });
  assert.equal(photo.statusCode, 200, photo.body);
  assert.deepEqual(f.fake.calls.map(c => c.endpoint), ['/infer', '/infer']);
  const [d, p] = f.fake.calls.map(c => c.data);
  assert.ok(d.input_image.blob instanceof Blob); assert.equal(d.randomize_seed, false);
  assert.match(d.prompt, /^Transform this drawing into a photorealistic photo of a real dog\./); assert.match(d.prompt, /standing on all four legs, full body side view/i);
  assert.match(p.prompt, /^The same cat from this photo, standing on all four legs/); assert.match(p.prompt, /eye color/);
  assert.equal((await f.app.inject({ method: 'POST', url: '/gen/reference', payload: { imageId: f.imageId, species: 'cat', kind: 'sketch' } })).statusCode, 422);
  assert.equal(f.fake.calls.length, 2);
});

test('free reference maps ZeroGPU quota to 429 gen_quota with retryAfter and then fails fast', async t => {
  const f = await editFixture(t, () => { throw { type: 'status', stage: 'error', message: QUOTA }; });
  const payload = { imageId: f.imageId, species: 'dog' };
  const r = await f.app.inject({ method: 'POST', url: '/gen/reference', payload });
  assert.equal(r.statusCode, 429, r.body); assert.equal(r.json().code, 'gen_quota');
  assert.ok(r.json().retryAfter > 23 * 3600 && r.json().retryAfter <= 23 * 3600 + 53 * 60 + 46, r.body); assert.ok(Number(r.headers['retry-after']) > 0);
  assert.equal((await f.app.inject({ method: 'POST', url: '/gen/reference', payload })).statusCode, 429);
  assert.equal(f.fake.calls.length, 1);
});

test('free reference only downloads the edit from the edit Space host', async t => {
  const f = await editFixture(t, () => [{ url: 'https://trellis-community-trellis.hf.space/gradio_api/file=/tmp/gradio/out.webp' }, 0]);
  const r = await f.app.inject({ method: 'POST', url: '/gen/reference', payload: { imageId: f.imageId, species: 'dog' } });
  assert.equal(r.statusCode, 502, r.body); assert.equal(r.json().code, 'provider_failed'); assert.deepEqual(f.fetched, []);
  assert.equal(spaceHost(EDIT_SPACE), 'black-forest-labs-flux-1-kontext-dev.hf.space');
});
