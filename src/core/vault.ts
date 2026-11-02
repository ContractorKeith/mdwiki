import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AppError, success } from '../output.js';
import { exists, readBounded, safeFile, safeLocation, vaultRoot } from './paths.js';

export interface Selection { vault?: string; indexDir?: string; cwd?: string }
export interface Vault { root: string; indexDir: string; identity: { dev: bigint; ino: bigint } }
// Pin the physical root for this process; a pathname alone can be replaced.
export async function validateVault(vault: Vault) {
  const state = await lstat(vault.root, { bigint: true }).catch(() => undefined);
  if (!state?.isDirectory() || state.dev !== vault.identity.dev || state.ino !== vault.identity.ino) {
    throw new AppError('UNSAFE_PATH', 'Selected vault root was removed or replaced.');
  }
}
interface Config { schema_version: 1; vault: string; index_dir: string }
async function readConfig(path: string): Promise<Config> {
  await safeFile(path);
  try {
    const value: unknown = JSON.parse((await readBounded(path, 16 * 1024)).toString('utf8'));
    const c = value as Partial<Config> | null;
    if (!c || c.schema_version !== 1 || typeof c.vault !== 'string' || typeof c.index_dir !== 'string'
      || !c.vault.startsWith('/') || !c.index_dir.startsWith('/')) throw new Error();
    return c as Config;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('CONFIG_ERROR', 'Invalid mdwiki config or vault binding.', 5);
  }
}
async function bind(indexDir: string, root: string, readOnly = false) {
  await safeLocation(indexDir);
  const binding = join(indexDir, 'vault.json');
  await safeFile(binding);
  if (await exists(binding)) {
    const config = await readConfig(binding);
    if (config.vault !== root || config.index_dir !== indexDir) {
      throw new AppError('CONFLICT', 'Cache directory is bound to another vault or location.', 4);
    }
  } else if (!readOnly) {
    await mkdir(indexDir, { recursive: true });
    try {
      await writeFile(binding, JSON.stringify({ schema_version: 1, vault: root, index_dir: indexDir }) + '\n', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Another cooperating process may have bound the same new cache first.
      await bind(indexDir, root, true);
    }
  }
}
async function selectedRoot(selection: Selection) {
  if (selection.vault !== undefined) return vaultRoot(resolve(selection.cwd ?? process.cwd(), selection.vault));
  let current = await realpath(selection.cwd ?? process.cwd());
  for (;;) {
    const metadata = join(current, '.mdwiki');
    if (await exists(metadata)) {
      await safeLocation(metadata);
      if (await exists(join(metadata, 'config.json'))) return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new AppError('NOT_FOUND', 'No initialized vault found; use init --vault DIR.', 3);
    current = parent;
  }
}
export async function selectVault(selection: Selection, readOnly = false): Promise<Vault> {
  const root = await selectedRoot(selection);
  const identity = await lstat(root, { bigint: true });
  const metadata = join(root, '.mdwiki');
  await safeLocation(metadata);
  if (!(await exists(join(metadata, 'config.json')))) throw new AppError('NOT_FOUND', 'Vault is not initialized.', 3);
  const config = await readConfig(join(metadata, 'config.json'));
  if (config.vault !== root) throw new AppError('CONFLICT', 'Marker is bound to another vault.', 4);
  let indexDir = selection.indexDir === undefined ? config.index_dir
    : resolve(selection.cwd ?? process.cwd(), selection.indexDir);
  indexDir = await safeLocation(indexDir);
  if (indexDir === root) throw new AppError('VALIDATION_ERROR', 'Cache directory cannot be the vault root.');
  await bind(indexDir, root, readOnly);
  const vault = { root, indexDir, identity: { dev: identity.dev, ino: identity.ino } };
  await validateVault(vault);
  return vault;
}
export async function initVault(selection: Selection) {
  if (!selection.vault) throw new AppError('VALIDATION_ERROR', 'init requires --vault DIR.');
  const root = await selectedRoot(selection);
  const metadata = await safeLocation(join(root, '.mdwiki'));
  const configPath = join(metadata, 'config.json');
  await safeFile(configPath);
  const prior = await exists(configPath) ? await readConfig(configPath) : undefined;
  let indexDir = selection.indexDir === undefined ? prior?.index_dir ?? metadata
    : resolve(selection.cwd ?? process.cwd(), selection.indexDir);
  indexDir = await safeLocation(indexDir);
  if (indexDir === root) throw new AppError('VALIDATION_ERROR', 'Cache directory cannot be the vault root.');
  if (prior && (prior.vault !== root || prior.index_dir !== indexDir)) {
    throw new AppError('CONFLICT', 'Initialization cannot change an existing vault/cache binding.', 4);
  }
  await safeFile(join(metadata, '.gitignore'));
  await bind(indexDir, root);
  await mkdir(metadata, { recursive: true });
  if (!prior) await writeFile(configPath, JSON.stringify({ schema_version: 1, vault: root, index_dir: indexDir }) + '\n', { flag: 'wx' });
  if (!(await exists(join(metadata, '.gitignore')))) await writeFile(join(metadata, '.gitignore'), '*\n', { flag: 'wx' });
  return success({ vault: root, index_dir: indexDir });
}

// Bind only when a real indexed operation needs storage; previews never call this.
export async function bindCache(vault: Vault) {
  await validateVault(vault);
  await bind(vault.indexDir, vault.root);
}
