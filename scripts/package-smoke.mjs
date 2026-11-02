import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync, symlinkSync } from 'node:fs';
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
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const allowed = metadata.files;
  assert.ok(files.every(file => file === 'package.json' || allowed.some(path =>
    path.endsWith('/') ? file.startsWith(path) : file === path)));
  assert.ok(files.every(file => !/(^|\/)(?:node_modules|tests|\.env|\.git|\.scratch)(?:\/|$)/.test(file)));
  assert.ok(files.every(file => !file.endsWith('.tgz')));
  for (const path of allowed.filter(path => !path.endsWith('/'))) assert.ok(files.includes(path), path);
  assert.ok(files.includes('examples/cli-workflow.sh'));
  assert.ok(files.includes('examples/mcp-workflow.mjs'));
  assert.ok(packed.unpackedSize < 1024 * 1024);
  console.log(`Packed ${packed.filename} (${packed.unpackedSize} unpacked bytes)`);
  console.log(run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev',
    '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, packed.filename)]).trim());
  const installed = join(prefix, 'lib', 'node_modules', 'mdwiki');
  const installedDependencies = run('npm', ['ls', '--global', '--prefix', prefix, '--all', '--parseable'])
    .trim().split('\n').filter(path => path.startsWith(join(prefix, 'lib', 'node_modules') + '/'))
    .map(path => {
      const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
      assert.ok(pkg.license, `Missing license: ${pkg.name}`);
      return { name: pkg.name, version: pkg.version, license: pkg.license };
    });
  assert.ok(!installedDependencies.some(pkg => ['eslint', 'typescript', 'typescript-eslint'].includes(pkg.name)));
  // Exclude user/global npm binary directories during application exercises.
  const runtimeBin = join(scratch, 'runtime-bin');
  mkdirSync(runtimeBin);
  symlinkSync(process.execPath, join(runtimeBin, 'node'));
  assert.ok(process.env.npm_execpath, 'Run via npm run test:installed');
  symlinkSync(process.env.npm_execpath, join(runtimeBin, 'npm'));

  console.log(run(process.execPath, ['--test', 'tests/*.test.mjs'], {
    env: { ...env, PATH: `${runtimeBin}:/usr/bin:/bin`, NODE_PATH: '', MDWIKI_TEST_BIN: join(prefix, 'bin', 'mdwiki'),
      MDWIKI_TEST_PACKAGE: installed,
      MDWIKI_TEST_CORE: join(installed, 'dist'),
      MDWIKI_TEST_SCHEMA: join(installed, 'dist', 'index', 'schema.js') },
  }));
  if (process.env.MDWIKI_ARTIFACT_DIR) {
    const destination = resolve(process.env.MDWIKI_ARTIFACT_DIR);
    mkdirSync(destination, { recursive: true });
    const tarball = join(destination, packed.filename);
    copyFileSync(join(scratch, packed.filename), tarball);
    const evidence = { tarball, sha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
      node: process.version, platform: process.platform, arch: process.arch,
      packed, installed_dependencies: installedDependencies, installed_suite_passed: true };
    writeFileSync(join(destination, 'artifact.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ tarball, sha256: evidence.sha256 }));
  }
  console.log('Installed mdwiki: help/version, vault init/list/tree/read/search/backlinks/reindex, recovery, validation, MCP and SQLite checks passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
