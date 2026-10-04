import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Species } from './types.js';
import { ApiError } from '../errors.js';

/** Convert F1's pre-generated rest-pose splat into raw Gaussian PLY for its parsePly pipeline. */
export async function mockPly(bundleDir: string, species: Species) {
  if (species !== 'dog' && species !== 'bird') throw new ApiError(422, 'gen_failed', 'Mock generation supports dog and bird');
  const splat = await readFile(join(bundleDir, species, 'pet.splat'));
  if (!splat.length || splat.length % 32) throw new ApiError(500, 'gen_failed');
  const count = splat.length / 32;
  const names = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${names.map(n => `property float ${n}\n`).join('')}end_header\n`);
  const data = Buffer.alloc(count * names.length * 4);
  for (let i = 0; i < count; i++) {
    const offset = i * 32; const out = i * names.length * 4;
    for (let j = 0; j < 3; j++) {
      data.writeFloatLE(splat.readFloatLE(offset + j * 4), out + j * 4);
      data.writeFloatLE(Math.log(Math.max(1e-8, splat.readFloatLE(offset + 12 + j * 4))), out + (3 + j) * 4);
      data.writeFloatLE((splat[offset + 24 + j] / 255 - .5) / .28209479, out + (10 + j) * 4);
    }
    for (let j = 0; j < 4; j++) data.writeFloatLE((splat[offset + 28 + j] - 128) / 128, out + (6 + j) * 4);
    const alpha = Math.max(.00001, Math.min(.99999, splat[offset + 27] / 255));
    data.writeFloatLE(Math.log(alpha / (1 - alpha)), out + 13 * 4);
  }
  return Buffer.concat([header, data]);
}
export async function mockSticker() {
  return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="48" y="24" width="160" height="208" rx="18" fill="#fff3cb" stroke="#73533f" stroke-width="8"/><path d="M78 88h100M78 120h100M78 152h70" stroke="#73533f" stroke-width="10" stroke-linecap="round"/></svg>')).png().toBuffer();
}
// A deterministic short demo chime, never represented as actual speech or species SFX.
export function mockAudio() {
  const rate = 22050, samples = rate / 3 | 0; const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 660) * 2500 * Math.sin(Math.PI * i / samples)), 44 + i * 2);
  return b;
}
