import { DatabaseSync } from 'node:sqlite';
import { cacheFile } from './cache.js';
import type { Vault } from './vault.js';
import { AppError } from '../output.js';

// Stable SQLite inodes release transactions on process death. Never unlink a
// coordinator or its sidecars while any cooperating process may be using it.
const queues = new Map<string, Promise<unknown>>();
export async function coordinate<T>(vault: Vault, name: string, action: () => Promise<T>): Promise<T> {
  const key = vault.indexDir + '/' + name;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    let lock: DatabaseSync | undefined;
    try {
      lock = new DatabaseSync(await cacheFile(vault, name));
      lock.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      lock.exec('CREATE TABLE IF NOT EXISTS binding (vault TEXT NOT NULL)');
      const rows = lock.prepare('SELECT vault FROM binding').all();
      if (!rows.length) lock.prepare('INSERT INTO binding VALUES (?)').run(vault.root);
      else if (rows.length !== 1 || rows[0]!.vault !== vault.root) throw new AppError('CONFLICT', 'Coordinator belongs to another vault.', 4);
      const result = await action();
      lock.exec('COMMIT');
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
      throw new AppError('OPERATIONAL_ERROR', `Cannot use coordinator ${key}; retry or restore access. Do not remove a live coordinator. For a data-cache error at ${vault.indexDir}/index.sqlite run mdwiki --vault ${quote(vault.root)} --index-dir ${quote(vault.indexDir)} reindex --full.`, 5);
    } finally { lock?.close(); }
  });
  queues.set(key, next);
  try { return await next; }
  finally { if (queues.get(key) === next) queues.delete(key); }
}
