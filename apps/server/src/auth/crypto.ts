// Encryption for connector refresh tokens at rest (AES-256-GCM).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function resolveKey(tokenEncKey: string, fallbackSecret: string): Buffer {
  if (tokenEncKey) {
    const key = Buffer.from(tokenEncKey, 'base64');
    if (key.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64-encoded');
    return key;
  }
  // Dev fallback: derive from the session secret so local runs work without extra setup.
  return createHash('sha256').update(`token-enc:${fallbackSecret}`).digest();
}

/** Returns base64(iv | tag | ciphertext). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
