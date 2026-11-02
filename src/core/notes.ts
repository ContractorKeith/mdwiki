import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, success } from '../output.js';
import { exactNote, notePath, NOTE_LIMIT, readBounded } from './paths.js';
import { frontmatter } from './frontmatter.js';
import { validateVault, type Vault } from './vault.js';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function bound(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new AppError('VALIDATION_ERROR', `Expected an integer between 1 and ${max}.`);
  }
  return value;
}
export async function scan(vault: Vault) {
  const notes: { path: string; size: number; mtime: string; ctime: string }[] = [];
  const folders: string[] = [];
  const directories = new Map<string, { dev: bigint; ino: bigint }>();
  // Recheck the whole parent chain; Dirents describe an earlier observation.
  const validateDirectory = async (prefix: string) => {
    await validateVault(vault);
    let current = vault.root;
    for (const part of prefix.split('/').filter(Boolean)) {
      current = join(current, part);
      const state = await lstat(current, { bigint: true });
      const prior = directories.get(current);
      if (current === vault.indexDir || !state.isDirectory()
        || (prior && (state.dev !== prior.dev || state.ino !== prior.ino))) {
        throw new AppError('UNSAFE_PATH', 'Scan directory is excluded or was replaced; retry.');
      }
      directories.set(current, { dev: state.dev, ino: state.ino });
    }
  };
  const walk = async (directory: string, prefix: string) => {
    await validateDirectory(prefix);
    const entries = await readdir(directory, { withFileTypes: true });
    await validateDirectory(prefix);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.includes('\\') || entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (absolute === vault.indexDir) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, path + '/');
        folders.push(path);
      } else if (entry.isFile() && /\.md$/i.test(path)) {
        try { notePath(path); } catch { continue; }
        // Revalidate with the same policy used for reads.
        const state = await lstat(await exactNote(vault.root, path, vault.indexDir), { bigint: true });
        notes.push({ path, size: Number(state.size), mtime: state.mtimeNs.toString(), ctime: state.ctimeNs.toString() });
      }
    }
    await validateDirectory(prefix);
  };
  await walk(vault.root, '');
  await validateVault(vault);
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
export async function readRawNote(vault: Vault, path: unknown) {
  const validate = async () => {
    await validateVault(vault);
    return exactNote(vault.root, path, vault.indexDir);
  };
  const absolute = await validate();
  const bytes = await readBounded(absolute, NOTE_LIMIT, validate);
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AppError('INVALID_UTF8', 'Note is not valid UTF-8.'); }
  return { path: path as string, content, content_version: digest(bytes) };
}
export async function readNote(vault: Vault, path: unknown) {
  const raw = await readRawNote(vault, path);
  const parsed = frontmatter(raw.content, raw.path);
  return success({ ...raw, title: parsed.title, metadata: parsed.metadata }, parsed.diagnostics);
}
