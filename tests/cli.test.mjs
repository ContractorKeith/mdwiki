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
    ['--json', 'version']]) {
    const result = await run(t, args, cwd);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    const body = JSON.parse(result.stdout);
    assert.equal(body.schema_version, 1);
    assert.equal(body.ok, true);
    assert.equal(body.degraded, false);
    assert.deepEqual(body.diagnostics, []);
    assert.equal(body.data.version, version);
    if (args.includes('help')) assert.deepEqual(body.data.commands, ['help', 'version', 'mcp']);
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
