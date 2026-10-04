import { randomUUID } from 'node:crypto';
import type { DB } from './index.js';
import { transaction } from './index.js';
import type { AssetStore } from '../media/storage.js';
import { defaults, petMetadataSchema, petPatchSchema, type PetBundle, type Species } from '../media/types.js';
import { ApiError } from '../errors.js';
import type { z } from 'zod';

interface PetRow { id: string; user_id: string; metadata: string; asset_ids: string; created_at: string; stats: string }
interface AssetIds { splat: string; rig: string; weights: string; thumbnail: string }
export class PetsRepository {
  constructor(readonly db: DB, readonly storage: AssetStore) {}
  private row(id: string, userId?: string) {
    const r = this.db.prepare('SELECT pets.*, pet_stats.stats FROM pets JOIN pet_stats ON pets.id=pet_stats.pet_id WHERE pets.id=?').get(id) as unknown as PetRow | undefined;
    if (!r || (userId !== undefined && r.user_id !== userId)) throw new ApiError(404, 'pet_not_found');
    return r;
  }
  private bundle(r: PetRow): PetBundle {
    const meta = JSON.parse(r.metadata) as z.infer<typeof petMetadataSchema>;
    const assets = JSON.parse(r.asset_ids) as AssetIds;
    return { id: r.id, name: meta.name, species: meta.species, personality: meta.personality!, stats: JSON.parse(r.stats),
      ...(meta.voiceId ? { voiceId: meta.voiceId } : {}), createdAt: r.created_at,
      splatUrl: this.storage.url(assets.splat), rigUrl: this.storage.url(assets.rig), weightsUrl: this.storage.url(assets.weights), thumbnailUrl: this.storage.url(assets.thumbnail) };
  }
  // Trusted in-process B1 API. HTTP callers always pass userId.
  async get(id: string): Promise<{ id: string; name: string; species: Species; personality: PetBundle['personality'] }> {
    const r = this.row(id); const m = JSON.parse(r.metadata);
    return { id, name: m.name, species: m.species, personality: m.personality };
  }
  getBundle(id: string, userId: string) { return this.bundle(this.row(id, userId)); }
  list(userId: string) {
    const rows = this.db.prepare('SELECT pets.*, pet_stats.stats FROM pets JOIN pet_stats ON pets.id=pet_stats.pet_id WHERE user_id=? ORDER BY created_at DESC').all(userId) as unknown as PetRow[];
    return rows.map(r => this.bundle(r));
  }
  create(userId: string, metadata: z.infer<typeof petMetadataSchema>, assets: AssetIds) {
    const id = randomUUID(); const { stats, ...meta } = metadata;
    transaction(this.db, () => {
      this.db.prepare('INSERT INTO pets VALUES (?, ?, ?, ?, ?)').run(id, userId, JSON.stringify({ ...meta, personality: meta.personality ?? defaults[meta.species] }), JSON.stringify(assets), new Date().toISOString());
      this.db.prepare('INSERT INTO pet_stats VALUES (?, ?)').run(id, JSON.stringify(stats ?? { energy: 100, happiness: 80, hunger: 0 }));
    });
    return this.getBundle(id, userId);
  }
  patch(id: string, userId: string, input: unknown) {
    const patch = petPatchSchema.parse(input); const r = this.row(id, userId); const meta = JSON.parse(r.metadata);
    transaction(this.db, () => {
      this.db.prepare('UPDATE pets SET metadata=? WHERE id=?').run(JSON.stringify({ ...meta,
        ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.voiceId !== undefined ? { voiceId: patch.voiceId } : {}),
        personality: { ...meta.personality, ...patch.personality } }), id);
      this.db.prepare('UPDATE pet_stats SET stats=? WHERE pet_id=?').run(JSON.stringify({ ...JSON.parse(r.stats), ...patch.stats }), id);
    });
    return this.getBundle(id, userId);
  }
  async delete(id: string, userId: string) {
    const r = this.row(id, userId);
    this.db.prepare('DELETE FROM pets WHERE id=?').run(id);
    for (const asset of Object.values(JSON.parse(r.asset_ids) as AssetIds)) await this.storage.remove(asset);
  }
}
