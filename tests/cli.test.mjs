import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from './process-helpers.mjs';
import { version } from '../dist/metadata.js';

test('help and version in human and JSON forms from a disposable cwd', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'mdwiki-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const args of [[], ['help'], ['--help'], ['-h'], ['version'], ['--version'], ['-v']]) {
    const result = await run(t, args, cwd);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, new RegExp(`mdwiki ${version.replaceAll('.', '\\.').replaceAll('-', '\\-')}`));
  }
  for (const args of [['--json', 'help'], ['help', '--json'], ['--version', '--json'],
    ['--json', 'version'], ['--vault', '/unused', 'help', '--json'],
    ['--index-dir', '/unused', '--help', '--json']]) {
    const result = await run(t, args, cwd);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    const body = JSON.parse(result.stdout);
    assert.equal(body.schema_version, 1);
    assert.equal(body.ok, true);
    assert.equal(body.degraded, false);
    assert.deepEqual(body.diagnostics, []);
    assert.equal(body.data.version, version);
    if (args.includes('help')) assert.deepEqual(body.data.commands, ['help', 'version', 'init', 'list', 'tree', 'read', 'search', 'backlinks', 'write', 'append', 'reindex', 'watch', 'mcp']);
  }
  assert.deepEqual(await readdir(cwd), []);
});

test('usage failures are stable, structured on stdout only with --json', async (t) => {
  for (const args of [['--unknown'], ['missing'], ['help', 'extra'], ['--help', '--bogus'],
    ['--help', '--version'], ['mcp', '--json'], ['--vault', '/unavailable']]) {
    for (const json of [false, true]) {
      const result = await run(t, [...args, ...(json ? ['--json'] : [])], tmpdir());
      assert.equal(result.code, 2);
      if (json || args.includes('--json')) {
        const body = JSON.parse(result.stdout);
        assert.equal(body.schema_version, 1);
        assert.equal(body.ok, false);
        assert.equal(body.error.code, 'VALIDATION_ERROR');
        assert.equal(typeof body.error.message, 'string');
        assert.equal(body.degraded, false);
        assert.deepEqual(body.diagnostics, []);
        assert.equal(result.stderr, '');
      } else {
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /^VALIDATION_ERROR: /);
        assert.doesNotMatch(result.stderr, /\n\s+at /);
      }
    }
  }
});

test('closed stdout exits without a stack trace', async (t) => {
  const { start } = await import('./process-helpers.mjs');
  const { child, closed } = start(t, ['--help'], tmpdir());
  child.stdout.destroy();
  child.stdin.end();
  const result = await closed;
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
});

test('real CLI initializes, discovers, pages, browses and reads a fixture with before/after flags', async (t) => {
  const { mkdir, writeFile, readFile, realpath } = await import('node:fs/promises');
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'mdwiki-cli-vault-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const vault = join(cwd, 'vault');
  await mkdir(join(vault, 'nested'), { recursive: true });
  const content = '\uFEFF---\r\ntitle: Example\r\n---\r\n# Body\r\n';
  await writeFile(join(vault, 'hello world.MD'), content);
  await writeFile(join(vault, 'nested/é.md'), '# Unicode\n');
  async function json(args, code = 0, from = cwd) {
    const result = await run(t, [...args, '--json'], from);
    assert.equal(result.code, code, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  }
  const initial = await json(['--vault', vault, 'init', '--index-dir', 'cache']);
  assert.equal(initial.data.index_dir, join(cwd, 'cache'));
  assert.deepEqual(await json(['init', '--vault', vault]), initial);
  await json(['init', '--vault', vault, '--index-dir', 'different'], 4);
  const listing = await json(['--vault', vault, 'list', '--limit', '1']);
  assert.equal(listing.data.entries[0].path, 'hello world.MD');
  const next = await json(['list', '--vault', vault, '--limit', '1', '--cursor', listing.data.next_cursor]);
  assert.equal(next.data.entries[0].path, 'nested/é.md');
  assert.equal(next.data.next_cursor, null);
  const discovered = await json(['read', 'hello world.MD'], 0, join(vault, 'nested'));
  assert.equal(discovered.data.content, content);
  const human = await run(t, ['read', 'hello world.MD', '--vault', vault], cwd);
  assert.equal(human.stdout, content);
  assert.equal(human.stderr, '');
  assert.equal(human.code, 0);
  const truncated = await json(['tree', '--vault', vault, '--depth', '1'], 6);
  assert.equal(truncated.data.truncated, true);
  await json(['tree', '--vault', vault, '--depth', '5']);
  for (const args of [['list', '--limit', '0'], ['list', '--limit', '1.5'], ['list', '--cursor', 'bad'],
    ['read', '../escape.md'], ['tree', '--depth', '51'], ['read', 'hello world.MD', '--limit', '1']]) {
    const failure = await json([...args, '--vault', vault], 2);
    assert.equal(failure.error.code, 'VALIDATION_ERROR');
  }
  await json(['read', 'missing.md', '--vault', vault], 3);
  await writeFile(join(vault, 'invalid.md'), '---\ntags: oops\n---\nbody');
  const degraded = await json(['read', 'invalid.md', '--vault', vault], 6);
  assert.equal(degraded.diagnostics[0].code, 'INVALID_METADATA');
  assert.equal(await readFile(join(vault, 'hello world.MD'), 'utf8'), content);
});
