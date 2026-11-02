import { lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { safeFile, safeLocation } from './paths.js';
import { validateVault, type Vault } from './vault.js';
import { AppError } from '../output.js';

// All cache artifacts are fixed names; never erase a caller-supplied directory.
export async function cacheFile(vault: Vault, name: string) {
  await validateVault(vault);
  await safeLocation(vault.indexDir);
  const path = join(vault.indexDir, name);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await safeFile(path + suffix);
    const state = await lstat(path + suffix).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (state && state.nlink !== 1) throw new AppError('UNSAFE_PATH', 'Cache files must not be hard linked.');
  }
  return path;
}
export async function publishCache(vault: Vault, staging: string) {
  const destination = await cacheFile(vault, 'index.sqlite');
  // Caller holds the coordinator transaction, and has closed every data connection.
  for (const suffix of ['-wal', '-shm', '-journal']) await rm(destination + suffix, { force: true });
  await rename(await cacheFile(vault, staging), destination);
}
export async function discardCache(vault: Vault, name: string) {
  const path = await cacheFile(vault, name);
  for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(path + suffix, { force: true });
}
