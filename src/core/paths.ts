import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { AppError } from '../output.js';

export const NOTE_LIMIT = 10 * 1024 * 1024;
export function notePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 4096 || !value || value.includes('\\')
    || value.includes('\0') || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => !part || part.startsWith('.')) || !/\.md$/i.test(value)) {
    throw new AppError('VALIDATION_ERROR', 'Use an exact visible relative Markdown path with extension.');
  }
}
export async function exists(path: string) {
  try { return await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
// Resolve normal ancestor symlinks only at the selected vault boundary.
export async function vaultRoot(path: string) {
  try {
    const root = await realpath(resolve(path));
    if (!(await lstat(root)).isDirectory()) throw new Error();
    return root;
  } catch { throw new AppError('NOT_FOUND', 'Vault must be an existing directory.', 3); }
}
// Metadata/cache paths must have no symlink components, including existing ancestors.
export async function safeLocation(path: string) {
  let absolute = resolve(path);
  // macOS exposes these system aliases above ordinary disposable temp roots.
  // Only canonicalize the system ancestor, never a metadata/cache entry.
  if (process.platform === 'darwin') {
    for (const ancestor of ['/var', '/tmp']) {
      if (absolute.startsWith(ancestor + '/')) absolute = (await realpath(ancestor)) + absolute.slice(ancestor.length);
    }
  }
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const state = await exists(current);
    if (state && (!state.isDirectory() || state.isSymbolicLink())) {
      throw new AppError('UNSAFE_PATH', 'Metadata/cache directories must not contain symlinks or files.');
    }
  }
  return absolute;
}
export async function safeFile(path: string) {
  const state = await exists(path);
  if (state && (!state.isFile() || state.isSymbolicLink())) {
    throw new AppError('UNSAFE_PATH', 'Metadata files must be regular files, never symlinks.');
  }
}
export async function readBounded(path: string, limit: number, validate?: () => Promise<unknown>) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = await handle.stat();
    await validate?.();
    const named = await lstat(path);
    if (named.isSymbolicLink() || named.dev !== state.dev || named.ino !== state.ino) {
      throw new AppError('CONFLICT', 'Path changed while opening; retry.', 4);
    }
    if (!state.isFile()) throw new AppError('UNSAFE_PATH', 'Expected a regular file.');
    if (state.size > limit) throw new AppError('SIZE_LIMIT', `File exceeds ${limit} byte limit.`);
    const buffer = Buffer.alloc(Math.min(state.size + 1, limit + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    // A growing file must never be returned as a truncated success.
    if (length > state.size || (await handle.stat()).size !== state.size) {
      throw new AppError('CONFLICT', 'File changed while reading; retry.', 4);
    }
    await validate?.();
    const final = await lstat(path);
    if (final.isSymbolicLink() || final.dev !== state.dev || final.ino !== state.ino) {
      throw new AppError('CONFLICT', 'Path changed while reading; retry.', 4);
    }
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
// readdir requires physical spelling even on case/normalization-insensitive filesystems.
export async function exactNote(root: string, path: unknown, cache: string) {
  notePath(path);
  let current = root;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!(await readdir(current)).includes(part)) throw new AppError('NOT_FOUND', 'Note not found by exact path.', 3);
    current = join(current, part);
    const state = await lstat(current);
    if (current === cache || state.isSymbolicLink()
      || (i < parts.length - 1 ? !state.isDirectory() : !state.isFile())) {
      throw new AppError('UNSAFE_PATH', 'Note path is excluded or contains a symlink.');
    }
  }
  return current;
}
