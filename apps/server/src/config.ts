import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const flag = (fallback: '0' | '1') => z.enum(['0', '1']).default(fallback).transform(v => v === '1');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_URL: z.url().default('http://localhost:3001'),
  WEB_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  DATA_DIR: z.string().default('./data'), DEV_AUTH: flag('0'), MOCK_GEN: flag('0'), MOCK_VOICE: flag('0'),
  ASSET_SIGNING_SECRET: z.string().default(''), ASSET_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  GEN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(300000),
  // Empty selects Replicate when its token is set, else the free Hugging Face Space.
  IMAGE_TO_3D_PROVIDER: z.enum(['', 'hf', 'replicate']).default(''),
  HF_TRELLIS_SPACE: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default('trellis-community/TRELLIS'),
  // Free /gen/reference edit when FAL_KEY is unset; any Space with FLUX.1 Kontext [dev]'s /infer signature.
  HF_EDIT_SPACE: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default('black-forest-labs/FLUX.1-Kontext-Dev'),
  HF_TOKEN: z.string().regex(/^(hf_\w+)?$/).default(''),
  REPLICATE_API_TOKEN: z.string().default(''),
  TRELLIS_VERSION: z.string().regex(/^[a-f0-9]{64}$/).default('e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c'),
  FAL_KEY: z.string().default(''), ELEVENLABS_API_KEY: z.string().default(''),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_flash_v2_5'),
  ELEVENLABS_VOICE_DOG: z.string().default(''), ELEVENLABS_VOICE_CAT: z.string().default(''),
  ELEVENLABS_VOICE_RODENT: z.string().default(''), ELEVENLABS_VOICE_BIRD: z.string().default(''),
  VISION_API_KEY: z.string().default(''), VISION_API_URL: z.url().default('https://api.openai.com/v1/chat/completions'),
  VISION_MODEL: z.string().default('gpt-4o-mini')
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(env);
  if (c.NODE_ENV === 'production' && (c.DEV_AUTH || c.ASSET_SIGNING_SECRET.length < 32)) {
    throw new Error('Production requires DEV_AUTH=0 and ASSET_SIGNING_SECRET of at least 32 characters');
  }
  return { ...c, IMAGE_TO_3D_PROVIDER: c.IMAGE_TO_3D_PROVIDER || (c.REPLICATE_API_TOKEN ? 'replicate' : 'hf'), DATA_DIR: resolve(c.DATA_DIR), PUBLIC_URL: c.PUBLIC_URL.replace(/\/$/, ''),
    origins: c.WEB_ORIGINS.split(',').map(s => new URL(s.trim()).origin),
    signingSecret: c.ASSET_SIGNING_SECRET || randomBytes(32).toString('hex'),
    bundleDir: fileURLToPath(new URL('../../web/public/bundles/', import.meta.url)) };
}
export type Config = ReturnType<typeof readConfig>;
