import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { ApiError } from '../errors.js';

export interface Asset { id: string; user_id: string; mime: string; size: number; created_at: string }
export class AssetStore {
  readonly dir: string;
  constructor(readonly db: DB, readonly config: Config) { this.dir = join(config.DATA_DIR, 'assets'); }
  async put(userId: string, data: Buffer, mime: string): Promise<string> {
    const id = randomUUID();
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(id), data, { flag: 'wx' });
    try {
      this.db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?)').run(id, userId, mime, data.length, new Date().toISOString());
    } catch (e) { await unlink(this.path(id)); throw e; }
    return id;
  }
  path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ApiError(404, 'asset_not_found');
    return join(this.dir, id);
  }
  get(id: string, userId?: string): Asset {
    const asset = this.db.prepare('SELECT * FROM assets WHERE id=?').get(id) as unknown as Asset | undefined;
    if (!asset || (userId !== undefined && asset.user_id !== userId)) throw new ApiError(404, 'asset_not_found');
    return asset;
  }
  async read(id: string, userId?: string) { this.get(id, userId); return readFile(this.path(id)); }
  url(id: string) {
    const expires = Math.floor(Date.now() / 1000) + this.config.ASSET_TTL_SECONDS;
    const signature = this.sign(id, expires);
    return `${this.config.PUBLIC_URL}/assets/${id}?expires=${expires}&signature=${signature}`;
  }
  private sign(id: string, expires: number) { return createHmac('sha256', this.config.signingSecret).update(`${id}:${expires}`).digest('hex'); }
  verify(id: string, expires: number, signature: string) {
    if (!Number.isSafeInteger(expires) || expires <= Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(signature)) throw new ApiError(403, 'asset_url_invalid');
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(this.sign(id, expires), 'hex'))) throw new ApiError(403, 'asset_url_invalid');
  }
  async remove(id: string) {
    await unlink(this.path(id)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
    this.db.prepare('DELETE FROM assets WHERE id=?').run(id);
  }
}
