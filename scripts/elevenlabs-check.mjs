// Checks the ElevenLabs key in apps/server/.env, one endpoint at a time, and says which one is refused.
//   node scripts/elevenlabs-check.mjs            check the key and list voices (to pick ELEVENLABS_VOICE_DOG / _CAT)
//   node scripts/elevenlabs-check.mjs --speak    also speak one short phrase (uses a few credits); add --voice=<id> to pick the voice
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../apps/server/.env');
if (!existsSync(envFile)) { console.error('apps/server/.env not found'); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const key = env.ELEVENLABS_API_KEY;
if (!key) { console.error('ELEVENLABS_API_KEY is empty in apps/server/.env'); process.exit(1); }
console.log(`key: ${key.slice(0, 5)}... (${key.length} characters), MOCK_VOICE=${env.MOCK_VOICE ?? '(unset)'}`);

const api = (path, init = {}) => fetch(`https://api.elevenlabs.io/v1/${path}`, { ...init, headers: { 'xi-api-key': key, ...(init.headers ?? {}) } });
const why = async r => { try { const j = await r.json(); return JSON.stringify(j.detail ?? j).slice(0, 200); } catch { return r.statusText; } };
let failed = 0;
const step = async (name, fn) => { try { const out = await fn(); console.log(`OK    ${name}${out ? ' - ' + out : ''}`); } catch (e) { failed++; console.log(`FAIL  ${name} - ${e.message}`); } };

await step('realtime speech-to-text token (single-use)', async () => {
  const r = await api('single-use-token/realtime_scribe', { method: 'POST' });
  if (!r.ok) throw new Error(`${r.status} ${await why(r)}`);
  return 'token minted';
});
let voices = [];
await step('list voices', async () => {
  const r = await api('voices');
  if (!r.ok) throw new Error(`${r.status} ${await why(r)}`);
  voices = (await r.json()).voices ?? [];
  return `${voices.length} voices`;
});
await step('account / credits', async () => {
  const r = await api('user/subscription');
  if (!r.ok) throw new Error(`${r.status} ${await why(r)} (not needed by the app)`);
  const s = await r.json();
  return `${s.tier}: ${s.character_count} of ${s.character_limit} credits used`;
});
if (process.argv.includes('--speak')) {
  const id = process.argv.find(x => x.startsWith('--voice='))?.slice(8) || env.ELEVENLABS_VOICE_DOG || voices[0]?.voice_id;
  await step('text-to-speech', async () => {
    if (!id) throw new Error('no voice id to try');
    const r = await api(`text-to-speech/${id}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hi! Want to play?', model_id: env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5' }) });
    if (!r.ok) throw new Error(`${r.status} ${await why(r)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(resolve(import.meta.dirname, '../apps/server/data-tts-check.mp3'), buf);
    return `${buf.length} bytes of audio (apps/server/data-tts-check.mp3)`;
  });
}
if (voices.length) {
  console.log('\nVoices (copy an id into ELEVENLABS_VOICE_DOG / ELEVENLABS_VOICE_CAT):');
  for (const v of voices.slice(0, 40)) console.log(`  ${v.voice_id}  ${v.name}${v.labels ? '  [' + Object.values(v.labels).join(', ') + ']' : ''}`);
}
process.exit(failed ? 1 : 0);
