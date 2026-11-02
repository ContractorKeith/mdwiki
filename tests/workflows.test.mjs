import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { cli } from './process-helpers.mjs';

const root = process.env.MDWIKI_TEST_PACKAGE ?? resolve(import.meta.dirname, '..');
for (const workflow of ['cli', 'mcp']) {
  test(`shipped ${workflow} workflow executes documented operations using selected binary`, async t => {
    let binary = cli;
    if (!process.env.MDWIKI_TEST_BIN) {
      const scratch = await mkdtemp(join(tmpdir(), 'mdwiki-workflow-bin-'));
      t.after(() => rm(scratch, { recursive: true, force: true }));
      binary = join(scratch, 'mdwiki');
      const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      await writeFile(binary, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`, { mode: 0o755 });
    }
    const result = spawnSync(workflow === 'cli' ? 'bash' : process.execPath,
      workflow === 'cli' ? [join(root, 'examples/cli-workflow.sh')]
        : [join(root, 'examples/mcp-workflow.mjs'), binary], {
        cwd: process.env.TMPDIR, env: { ...process.env, MDWIKI_BIN: binary },
        encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /CONFLICT/);
    assert.match(result.stdout, /content_version/);
    assert.match(result.stdout, workflow === 'cli' ? /More text/ : /needle/);
  });
}

test('package executable, metadata, docs and locked dependency license inventory are complete', async () => {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.bin.mdwiki, 'dist/cli.js');
  assert.equal(metadata.license, 'MIT');
  assert.equal(metadata.repository.url, 'git+https://github.com/ContractorKeith/mdwiki.git');
  assert.equal(metadata.engines.node, '>=26.13.0 <27');
  assert.match(await readFile(join(root, 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(await readFile(join(root, 'dist/cli.js'), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  if (process.env.MDWIKI_TEST_PACKAGE) assert.ok((await stat(cli)).mode & 0o111);
  for (const path of ['README.md', 'docs/USAGE.md', 'docs/AGENTS.md', 'docs/DEVELOPMENT.md',
    'docs/RELEASE.md', 'docs/ACCEPTANCE.md', 'docs/BENCHMARK.md', 'docs/features/v0.1/SPEC.md']) {
    assert.ok((await stat(join(root, path))).size > 0);
  }
  const inventory = JSON.parse(await readFile(join(root, 'docs/DEPENDENCIES.json'), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.deepEqual(inventory.packages, Object.entries(lock.packages).filter(([path]) => path).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, p]) => ({ path, version: p.version, development: p.dev ?? false, license: p.license ?? 'UNKNOWN' })));
  assert.ok(inventory.packages.every(p => p.license !== 'UNKNOWN'));
});
