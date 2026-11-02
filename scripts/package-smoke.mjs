import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'mdwiki-package-'));
const prefix = join(scratch, 'prefix');
const userconfig = join(scratch, 'user.npmrc');
const globalconfig = join(scratch, 'global.npmrc');
const cache = join(scratch, 'npm-cache');
mkdirSync(prefix);
writeFileSync(userconfig, '');
writeFileSync(globalconfig, '');
const env = {
  ...process.env,
  NODE_OPTIONS: '',
  npm_config_userconfig: userconfig,
  npm_config_globalconfig: globalconfig,
  npm_config_cache: cache,
  npm_config_prefix: prefix,
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  const [packed] = JSON.parse(run('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', scratch,
  ]));
  const files = packed.files.map((file) => file.path);
  assert.ok(files.includes('dist/cli.js'));
  assert.ok(files.includes('dist/mcp.js'));
  assert.ok(files.includes('dist/index/schema.js'));
  assert.ok(files.every((file) => file.startsWith('dist/')
    || ['package.json', 'README.md', 'LICENSE'].includes(file)));
  assert.ok(packed.unpackedSize < 1024 * 1024);
  console.log(`Packed ${packed.filename} (${packed.unpackedSize} unpacked bytes)`);
  console.log(run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev',
    '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, packed.filename)]).trim());
  const installed = join(prefix, 'lib', 'node_modules', 'mdwiki');
  console.log(run(process.execPath, ['--test', 'tests/*.test.mjs'], {
    env: { ...env, MDWIKI_TEST_BIN: join(prefix, 'bin', 'mdwiki'),
      MDWIKI_TEST_CORE: join(installed, 'dist'),
      MDWIKI_TEST_SCHEMA: join(installed, 'dist', 'index', 'schema.js') },
  }));
  console.log('Installed mdwiki: help/version, vault init/list/tree/read/search/backlinks/reindex, recovery, validation, MCP and SQLite checks passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
