import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { cacheFile, discardCache, publishCache } from '../core/cache.js';
import { scan, readRawNote } from '../core/notes.js';
import { frontmatter } from '../core/frontmatter.js';
import type { Vault } from '../core/vault.js';
import { AppError, success, type Diagnostic } from '../output.js';
import { parseLinks, linkResolver } from '../core/links.js';
import { backlinksCache, type BacklinksInput } from './backlinks.js';
import { notePath, exactNote } from '../core/paths.js';
import { openCache } from './schema.js';
import { compileQuery, searchCache, type SearchInput } from './search.js';

// Never unlink this coordinator: its stable inode serializes data DB opens,
// replacements and WAL cleanup. SQLite releases the transaction after a crash.
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const queues = new Map<string, Promise<unknown>>();
async function exclusive<T>(vault: Vault, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(vault.indexDir) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    let lock: DatabaseSync | undefined;
    try {
      lock = new DatabaseSync(await cacheFile(vault, 'coordinator.sqlite'));
      lock.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      lock.exec('CREATE TABLE IF NOT EXISTS binding (vault TEXT NOT NULL)');
      const rows = lock.prepare('SELECT vault FROM binding').all();
      if (!rows.length) lock.prepare('INSERT INTO binding VALUES (?)').run(vault.root);
      else if (rows.length !== 1 || rows[0]!.vault !== vault.root) throw new AppError('CONFLICT', 'Cache coordinator belongs to another vault.', 4);
      const result = await action();
      lock.exec('COMMIT');
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('OPERATIONAL_ERROR', `Cannot use cache ${vault.indexDir}/index.sqlite; retry, or run mdwiki --vault ${shellQuote(vault.root)} --index-dir ${shellQuote(vault.indexDir)} reindex --full. Coordinator errors require restoring access to ${vault.indexDir}/coordinator.sqlite (do not remove it while processes are running).`, 5);
    } finally { lock?.close(); }
  });
  queues.set(vault.indexDir, next);
  try { return await next; }
  finally { if (queues.get(vault.indexDir) === next) queues.delete(vault.indexDir); }
}

async function reconcile(vault: Vault, db: DatabaseSync, full: boolean) {
  // Complete discovery before starting a batch. Traversal failures must never
  // publish an empty/partial successful rebuild.
  const discovered = await scan(vault);
  const old = new Map(db.prepare('SELECT path, version FROM notes').all().map((row) => [row.path as string, row.version as string]));
  const oldFailures = JSON.stringify(db.prepare('SELECT * FROM failures ORDER BY path').all());
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let added = 0, changed = 0, removed = 0, unchanged = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM failures');
    const remove = (path: string) => {
      db.prepare('DELETE FROM documents WHERE path=?').run(path);
      db.prepare('DELETE FROM tags WHERE path=?').run(path);
      db.prepare('DELETE FROM notes WHERE path=?').run(path);
      db.prepare('DELETE FROM links WHERE source=?').run(path);
    };
    for (const { path } of discovered.notes) {
      seen.add(path);
      let raw: Awaited<ReturnType<typeof readRawNote>>;
      try { raw = await readRawNote(vault, path); }
      catch (error) {
        const code = error instanceof AppError ? error.code : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'NOT_FOUND' : 'UNREADABLE_NOTE';
        const message = code === 'NOT_FOUND' ? 'Note disappeared during reconciliation; retry.' : 'Note could not be read; excluded from current search results.';
        db.prepare('INSERT INTO failures VALUES (?, ?, ?)').run(path, code, message);
        if (old.has(path)) { remove(path); removed++; }
        continue;
      }
      if (!full && old.get(path) === raw.content_version) { unchanged++; continue; }
      const parsed = frontmatter(raw.content, path);
      if (old.has(path)) { remove(path); changed++; } else added++;
      db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)').run(path, raw.content_version, parsed.title,
        JSON.stringify(parsed.metadata), JSON.stringify(parsed.aliases), JSON.stringify(parsed.diagnostics));
      db.prepare('INSERT INTO documents(title, path, body, metadata) VALUES (?, ?, ?, ?)').run(parsed.title, path, parsed.body, parsed.metadataText);
      for (const [ordinal, occurrence] of parseLinks(raw.content).entries()) {
        db.prepare('INSERT INTO links VALUES (?, ?, ?, NULL, ?)').run(path, ordinal, JSON.stringify(occurrence), '{}');
      }
      for (const tag of new Set(parsed.tags)) db.prepare('INSERT INTO tags VALUES (?, ?)').run(path, tag);
    }
    for (const path of old.keys()) if (!seen.has(path)) { remove(path); removed++; }
    const failures = db.prepare('SELECT * FROM failures ORDER BY path').all();
    if (full || added || changed || removed || JSON.stringify(failures) !== oldFailures) {
      const resolve = linkResolver(db.prepare('SELECT path, aliases FROM notes ORDER BY path').all().map((row) => ({
        path: row.path as string, aliases: JSON.parse(row.aliases as string) as string[],
      })));
      const update = db.prepare('UPDATE links SET resolved=?, diagnostic=? WHERE source=? AND ordinal=?');
      for (const row of db.prepare('SELECT source, ordinal, occurrence FROM links ORDER BY source, ordinal').all()) {
        const occurrence = JSON.parse(row.occurrence as string) as { target: string };
        const resolution = resolve(row.source as string, occurrence.target);
        update.run(resolution.resolved, JSON.stringify(resolution), row.source!, row.ordinal!);
      }
      db.prepare('UPDATE state SET generation=?').run(randomUUID());
    }
    for (const row of db.prepare('SELECT diagnostics FROM notes ORDER BY path').all()) diagnostics.push(...JSON.parse(row.diagnostics as string) as Diagnostic[]);
    for (const row of failures) diagnostics.push({ path: row.path as string, code: row.code as string, message: row.message as string });
    db.exec('COMMIT');
    return { counts: { added, changed, removed, unchanged }, diagnostics };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function indexed(vault: Vault, input: { full?: boolean | undefined; search?: SearchInput; backlinks?: BacklinksInput } = {}) {
  // Validate before creating or changing any cache files.
  if (input.search) compileQuery(input.search.query);
  if (input.backlinks) { notePath(input.backlinks.path); await exactNote(vault.root, input.backlinks.path, vault.indexDir); }
  return exclusive(vault, async () => {
    const staging = `rebuild-${randomUUID()}.sqlite`;
    let db: DatabaseSync | undefined;
    try {
      db = openCache(await cacheFile(vault, input.full ? staging : 'index.sqlite'), vault.root);
      const { counts, diagnostics } = await reconcile(vault, db, input.full ?? false);
      if (input.full) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close(); db = undefined;
        await publishCache(vault, staging);
        db = openCache(await cacheFile(vault, 'index.sqlite'), vault.root);
      }
      if (input.backlinks) return success(backlinksCache(db, vault.root, input.backlinks), diagnostics);
      return input.search ? success(searchCache(db, vault.root, input.search), diagnostics)
        : success({ vault: vault.root, index_dir: vault.indexDir,
          generation: db.prepare('SELECT generation FROM state').get()!.generation as string, ...counts }, diagnostics);
    } finally {
      db?.close();
      if (input.full) await discardCache(vault, staging);
    }
  });
}
