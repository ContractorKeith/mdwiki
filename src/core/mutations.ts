import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError } from '../output.js';
import { adopt } from './adoption.js';
import { coordinate } from './coordinator.js';
import { exists, notePath, NOTE_LIMIT } from './paths.js';
import { readRawNote } from './notes.js';
import { validateVault, type Vault } from './vault.js';

export interface MutationInput { path: string; content: string; expected_version?: string | undefined; dry_run?: boolean | undefined }
interface MutationResult {
  path: string; dry_run: boolean; file_written: boolean; current_version: string | null;
  proposed_version: string; content_version: string; diff?: { before: string; after: string };
  publication_warning?: string;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export function validateContent(text: string) {
  if (!text.isWellFormed()) throw new AppError('INVALID_UTF8', 'Content must contain valid Unicode.');
  if (Buffer.byteLength(text) > NOTE_LIMIT) throw new AppError('SIZE_LIMIT', 'Input and resulting note must each be at most 10 MiB.');
}

// Pin observed directories and the target, and require physical spelling even on
// insensitive filesystems. Missing preview parents are validated without mkdir.
async function destination(vault: Vault, path: string, createParents: boolean) {
  await validateVault(vault);
  const chain: { path: string; dev: number; ino: number }[] = [];
  let current = vault.root;
  const parts = path.split('/');
  let missing = false;
  for (const [i, part] of parts.entries()) {
    const parent = current;
    current = join(parent, part);
    if (current === vault.indexDir) throw new AppError('UNSAFE_PATH', 'Note path is inside the selected cache.');
    let state = missing ? undefined : await exists(current);
    if (!missing && !(await readdir(parent)).includes(part) && state) throw new AppError('CONFLICT', 'Path spelling collides with an existing entry.', 4);
    if (i === parts.length - 1) return { absolute: current, state, chain };
    if (!state && createParents) {
      await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      if (!(await readdir(parent)).includes(part)) throw new AppError('CONFLICT', 'Parent spelling collides with an existing entry.', 4);
      state = await lstat(current);
    }
    if (state && (!state.isDirectory() || state.isSymbolicLink())) throw new AppError('UNSAFE_PATH', 'Parents must be visible regular directories, never symlinks.');
    if (state) chain.push({ path: current, dev: state.dev, ino: state.ino });
    else missing = true;
  }
  throw new AppError('VALIDATION_ERROR', 'Missing note path.');
}
async function recheck(vault: Vault, chain: { path: string; dev: number; ino: number }[]) {
  await validateVault(vault);
  for (const prior of chain) {
    const state = await lstat(prior.path);
    if (!state.isDirectory() || state.dev !== prior.dev || state.ino !== prior.ino) throw new AppError('CONFLICT', 'Parent changed during write; retry.', 4);
  }
}

export async function mutate(vault: Vault, input: MutationInput, append = false, clock = () => new Date()) {
  notePath(input.path);
  validateContent(input.content);
  let published: MutationResult | undefined;
  const action = async (): Promise<MutationResult> => {
    // Validate before any parent creation. A replacement never creates parents.
    const initial = await destination(vault, input.path, false);
    const replacing = input.expected_version !== undefined;
    if (!append && !replacing && initial.state) throw new AppError('CONFLICT', 'Exclusive creation requires a missing target.', 4);
    if ((append || replacing) && !initial.state) throw new AppError(replacing ? 'CONFLICT' : 'NOT_FOUND', 'Target no longer exists.', replacing ? 4 : 3);
    if (initial.state && (!initial.state.isFile() || initial.state.isSymbolicLink() || initial.state.nlink !== 1)) throw new AppError('UNSAFE_PATH', 'Writes require a regular file with exactly one hard link.');
    const old = initial.state ? await readRawNote(vault, input.path) : undefined;
    if (replacing && input.expected_version !== old?.content_version) throw new AppError('CONFLICT', 'Content version is stale; read the note again.', 4);
    const content = adopt(input.path, old?.content, input.content, append, clock().toISOString());
    validateContent(content);
    const proposed = digest(content);
    const result = { path: input.path, dry_run: !!input.dry_run, file_written: !input.dry_run,
      current_version: old?.content_version ?? null, proposed_version: proposed, content_version: proposed };
    if (input.dry_run) return { ...result, diff: { before: old?.content ?? '', after: content } };
    await recheck(vault, initial.chain);
    const target = await destination(vault, input.path, !append && !replacing);
    // Temporary names are hidden, exclusive, owned by this invocation only.
    const temporary = join(dirname(target.absolute), `.mdwiki-write-${randomUUID()}.tmp`);
    let owned = false;
    try {
      await recheck(vault, target.chain);
      const handle = await open(temporary, 'wx', initial.state ? initial.state.mode & 0o7777 : 0o666);
      owned = true;
      try {
        await handle.writeFile(content, 'utf8');
        if (initial.state) await handle.chmod(initial.state.mode & 0o7777);
        await handle.sync();
      } finally { await handle.close(); }
      await recheck(vault, target.chain);
      const latest = await destination(vault, input.path, false);
      if (old) {
        if (!latest.state || !latest.state.isFile() || latest.state.nlink !== 1
          || latest.state.dev !== initial.state!.dev || latest.state.ino !== initial.state!.ino
          || latest.state.mode !== initial.state!.mode
          || (await readRawNote(vault, input.path)).content_version !== old.content_version) throw new AppError('CONFLICT', 'Target changed before publication; retry.', 4);
        await recheck(vault, target.chain);
        await rename(temporary, target.absolute);
        owned = false;
        published = result;
      } else {
        if (latest.state) throw new AppError('CONFLICT', 'Target appeared before exclusive publication.', 4);
        // link() is atomic and refuses existing paths, including dangling symlinks.
        await link(temporary, target.absolute).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'EEXIST') throw new AppError('CONFLICT', 'Target appeared before exclusive publication.', 4);
          throw error;
        });
        published = result;
        await unlink(temporary); owned = false;
      }
      return result;
    } finally {
      if (owned) {
        // Do not follow a swapped parent to remove an unrelated file.
        await recheck(vault, target.chain);
        await unlink(temporary);
      }
    }
  };
  if (input.dry_run) return action();
  // Lock ordering: mutation transaction ends before application index work.
  // The vault-local coordinator is independent of --index-dir.
  try {
    return await coordinate({ ...vault, indexDir: join(vault.root, '.mdwiki') }, 'mutations.sqlite', action);
  } catch (error) {
    // Publication cannot be rolled back by a later cleanup/coordination error.
    if (published) return { ...published, publication_warning: 'File published, but mutation cleanup or coordinator finalization failed. Inspect owned temporary files after stopping writers; do not retry append.' };
    throw error;
  }
}
