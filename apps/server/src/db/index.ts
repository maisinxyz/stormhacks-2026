import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDatabase(dir: string) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'fetch.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()) {
    db.exec(`BEGIN;
      CREATE TABLE assets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX assets_user ON assets(user_id);
      CREATE TABLE pets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, metadata TEXT NOT NULL, asset_ids TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX pets_user ON pets(user_id);
      CREATE TABLE pet_stats (pet_id TEXT PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE, stats TEXT NOT NULL);
      CREATE TABLE gen_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, species TEXT NOT NULL, image_ids TEXT NOT NULL, status TEXT NOT NULL, asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL, error TEXT, prediction_id TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE props_cache (user_id TEXT NOT NULL, cache_key TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, PRIMARY KEY(user_id, cache_key));
      CREATE TABLE media_cache (user_id TEXT NOT NULL, kind TEXT NOT NULL, cache_key TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, PRIMARY KEY(user_id, kind, cache_key));
      CREATE TABLE voices (voice_id TEXT NOT NULL, user_id TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(voice_id, user_id));
      INSERT INTO schema_migrations VALUES (1, datetime('now'));
      COMMIT;`);
  }
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
