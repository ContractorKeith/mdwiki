import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, success } from '../output.js';
import { exactNote, notePath, NOTE_LIMIT, readBounded } from './paths.js';
import { frontmatter } from './frontmatter.js';
import type { Vault } from './vault.js';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function bound(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new AppError('VALIDATION_ERROR', `Expected an integer between 1 and ${max}.`);
  }
  return value;
}
async function scan(vault: Vault) {
  const notes: { path: string; size: number; mtime: string; ctime: string }[] = [];
  const folders: string[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.includes('\\') || entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (absolute === vault.indexDir) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        folders.push(path);
        await walk(absolute, path + '/');
      } else if (entry.isFile() && /\.md$/i.test(path)) {
        try { notePath(path); } catch { continue; }
        // Revalidate with the same policy used for reads.
        const state = await lstat(await exactNote(vault.root, path, vault.indexDir), { bigint: true });
        notes.push({ path, size: Number(state.size), mtime: state.mtimeNs.toString(), ctime: state.ctimeNs.toString() });
      }
    }
  };
  await walk(vault.root, '');
  notes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  folders.sort();
  return { notes, folders, generation: digest(JSON.stringify({ notes, folders })) };
}
export async function listNotes(vault: Vault, args: { limit?: unknown; cursor?: unknown } = {}) {
  const limit = bound(args.limit, 50, 200);
  const { notes, generation } = await scan(vault);
  let offset = 0;
  if (args.cursor !== undefined) {
    try {
      if (typeof args.cursor !== 'string' || args.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(args.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString()) as Record<string, unknown>;
      if (cursor.vault !== digest(vault.root) || cursor.generation !== generation || cursor.limit !== limit
        || !Number.isSafeInteger(cursor.offset) || (cursor.offset as number) < 1 || (cursor.offset as number) >= notes.length) throw new Error();
      offset = cursor.offset as number;
    } catch { throw new AppError('VALIDATION_ERROR', 'Malformed, mismatched or stale list cursor; restart listing.'); }
  }
  const next = offset + limit;
  const cursor = next < notes.length ? Buffer.from(JSON.stringify({ vault: digest(vault.root), generation, limit, offset: next })).toString('base64url') : null;
  return success({ entries: notes.slice(offset, next).map(({ path }) => ({ path })), next_cursor: cursor, generation });
}
export async function treeNotes(vault: Vault, args: { depth?: unknown; limit?: unknown } = {}) {
  const depth = bound(args.depth, 3, 50);
  const limit = bound(args.limit, 200, 200);
  const { notes, folders, generation } = await scan(vault);
  const all = [...folders.map((path) => ({ path, type: 'directory' as const })),
    ...notes.map(({ path }) => ({ path, type: 'note' as const }))].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const visible = all.filter(({ path }) => path.split('/').length <= depth);
  const truncated = visible.length > limit || visible.length < all.length;
  return success({ entries: visible.slice(0, limit), depth, limit, truncated, generation }, [], truncated);
}
export async function readNote(vault: Vault, path: unknown) {
  const absolute = await exactNote(vault.root, path, vault.indexDir);
  const bytes = await readBounded(absolute, NOTE_LIMIT, () => exactNote(vault.root, path, vault.indexDir));
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AppError('INVALID_UTF8', 'Note is not valid UTF-8.'); }
  const parsed = frontmatter(content, path as string);
  return success({ path: path as string, title: parsed.title, content,
    content_version: digest(bytes), metadata: parsed.metadata }, parsed.diagnostics);
}
