import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('npm pack builds an executable from a clean unbuilt source tree', async (t) => {
  const root = resolve(import.meta.dirname, '..');
  const scratch = await mkdtemp(join(tmpdir(), 'mdwiki-clean-pack-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  for (const name of ['src', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'LICENSE']) {
    await cp(join(root, name), join(scratch, name), { recursive: true });
  }
  // Reuse installed compiler dependencies; the source copy deliberately has no dist.
  await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: scratch, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, npm_config_ignore_scripts: 'false', npm_config_cache: join(scratch, 'cache') },
  });
  assert.equal(packed.error, undefined);
  assert.equal(packed.status, 0, packed.stderr);
  const [artifact] = JSON.parse(packed.stdout);
  assert.ok(artifact.files.some((file) => file.path === 'dist/cli.js'));
  const run = spawnSync(process.execPath, [join(scratch, 'dist/cli.js'), '--version', '--json'], {
    cwd: scratch, encoding: 'utf8', timeout: 8_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).ok, true);
});
