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
import { coordinate } from '../core/coordinator.js';
import { bindCache } from '../core/vault.js';
import { compileQuery, searchCache, type SearchInput } from './search.js';

export class DataCacheError extends AppError {}

export interface SyncReport {
  vault: string; generation: string; added: number; changed: number; removed: number; unchanged: number;
  updated: boolean; diagnostics: Diagnostic[];
}
export type IndexInput = { full?: boolean | undefined; search?: SearchInput; backlinks?: BacklinksInput };

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
      try {
        try { raw = await readRawNote(vault, path); }
        catch (error) {
          // Atomic publication can replace an open inode. Retry once through all
          // path/read checks; persistent conflicts still exclude the note below.
          if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error;
          raw = await readRawNote(vault, path);
        }
      }
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
    const updated = Boolean(full || added || changed || removed || JSON.stringify(failures) !== oldFailures);
    if (updated) {
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
    return { counts: { added, changed, removed, unchanged }, diagnostics, updated };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function indexed(vault: Vault, input: IndexInput = {}, committed?: (report: SyncReport) => void) {
  // Validate before creating or changing any cache files.
  if (input.search) compileQuery(input.search.query);
  if (input.backlinks) { notePath(input.backlinks.path); await exactNote(vault.root, input.backlinks.path, vault.indexDir); }
  await bindCache(vault);
  return coordinate(vault, 'coordinator.sqlite', async () => {
    const staging = `rebuild-${randomUUID()}.sqlite`;
    let db: DatabaseSync | undefined;
    try {
      const filename = await cacheFile(vault, input.full ? staging : 'index.sqlite');
      try { db = openCache(filename, vault.root); }
      catch { throw new DataCacheError('OPERATIONAL_ERROR', `Cannot open data cache ${filename}; run mdwiki --vault '${vault.root.replaceAll("'", "'\\''")}' --index-dir '${vault.indexDir.replaceAll("'", "'\\''")}' reindex --full.`, 5); }
      const { counts, diagnostics, updated } = await reconcile(vault, db, input.full ?? false);
      if (input.full) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close(); db = undefined;
        await publishCache(vault, staging);
        db = openCache(await cacheFile(vault, 'index.sqlite'), vault.root);
      }
      const generation = db.prepare('SELECT generation FROM state').get()!.generation as string;
      committed?.({ vault: vault.root, generation, ...counts, updated, diagnostics });
      if (input.backlinks) return success(backlinksCache(db, vault.root, input.backlinks), diagnostics);
      return input.search ? success(searchCache(db, vault.root, input.search), diagnostics)
        : success({ vault: vault.root, index_dir: vault.indexDir,
          generation, ...counts }, diagnostics);
    } finally {
      db?.close();
      if (input.full) await discardCache(vault, staging);
    }
  });
}
