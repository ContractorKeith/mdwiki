import { watch, lstatSync, type FSWatcher } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { validateVault, type Vault } from './vault.js';

// Notifications are hints only. Scans/reads apply the authoritative path policy.
export async function attach(vault: Vault, dirty: () => void, failed: (error: Error) => void): Promise<FSWatcher> {
  await validateVault(vault);
  const excluded = (path: string) => {
    const parts = path.split(/[\\/]/);
    if (isAbsolute(path) || parts.some((part) => part.startsWith('.'))) return true;
    const cacheRelative = relative(vault.indexDir, resolve(vault.root, path));
    if (cacheRelative === '' || (!cacheRelative.startsWith('..') && !isAbsolute(cacheRelative))) return true;
    // Node's recursive watcher otherwise installs watches on symlink targets.
    // Ignore them before descent, and recheck parents on later notifications.
    let current = vault.root;
    for (const part of parts) {
      current = resolve(current, part);
      try { if (lstatSync(current).isSymbolicLink()) return true; }
      catch { break; } // Deletions/access failures still need reconciliation.
    }
    return false;
  };
  const watcher = watch(vault.root, { recursive: true, ignore: excluded }, (_event, filename) => {
    if (!filename || !excluded(filename.toString())) dirty();
  });
  watcher.on('error', failed);
  return watcher;
}
