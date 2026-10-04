// Run after the build: verifies the deployable bundle, rather than TS test imports.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const dir = await mkdtemp(join(tmpdir(), 'fetch-smoke-'));
const socket = createServer();
await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: base, DATA_DIR: dir,
    MOCK_GEN: '1', MOCK_VOICE: '1', MOCK_AGENT: '1', MOCK_CONNECTORS: '1', REQUIRE_LOGIN: '0',
    DEMO_USER_ID: 'demo-user',
    SESSION_SECRET: 'smoke-session-secret-with-more-than-32-characters', ASSET_SIGNING_SECRET: 'smoke-asset-secret-with-more-than-32-characters',
    REPLICATE_API_TOKEN: '', FAL_KEY: '', ELEVENLABS_API_KEY: '', ANTHROPIC_API_KEY: '', VISION_API_KEY: ''
  }
});
let logs = '', spawnError; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', error => { spawnError = error; resolve(); }); });
try {
  let health;
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Compiled server exited: ${logs}`);
    try { health = await fetch(`${base}/health`); if (health.ok) break; } catch {}
    await delay(100);
  }
  assert.ok(health?.ok, `Server did not start: ${logs}`);
  assert.equal((await health.json()).mockGen, true);
  const session = await fetch(`${base}/session`); assert.equal(session.status, 200); assert.equal((await session.json()).user.id, 'demo-user');
  const pets = await fetch(`${base}/pets`); assert.equal(pets.status, 200); assert.deepEqual(await pets.json(), []);
  const voice = await fetch(`${base}/voice/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello!' }) });
  assert.equal(voice.status, 200); assert.equal(Buffer.from(await voice.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  console.log('Compiled server smoke passed: startup, health, B1 session, B2 pets, streamed audio.');
} finally {
  child.kill('SIGTERM'); await exited;
  const target = resolve(dir); assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('fetch-smoke-'));
  await rm(target, { recursive: true, force: true });
}
