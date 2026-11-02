import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, lstat, symlink, link, chmod, realpath } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { run, start, protocol } from './process-helpers.mjs';
const core = process.env.MDWIKI_TEST_CORE ?? new URL('../dist/', import.meta.url).pathname;
const { initVault, selectVault } = await import(pathToFileURL(join(core, 'core/vault.js')));
const { mutate } = await import(pathToFileURL(join(core, 'core/mutations.js')));
const { operate } = await import(pathToFileURL(join(core, 'operations.js')));
const { readNote } = await import(pathToFileURL(join(core, 'core/notes.js')));
const now = () => new Date('2026-11-02T12:34:56.000Z');
const rejects = (fn, code) => assert.rejects(fn, e => e.code === code);
async function fixture(t) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'mdwiki-writes-')));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const root = join(scratch, 'vault');
  await mkdir(root);
  await initVault({ vault: root });
  return { scratch, root, vault: await selectVault({ vault: root }, true) };
}
// Include bytes, permissions, identity, size and timestamps of every fixture entry.
async function snapshot(root) {
  const result = {};
  async function walk(path) {
    const state = await lstat(path, { bigint: true });
    result[path] = { ino: String(state.ino), mode: String(state.mode), size: String(state.size),
      mtime: String(state.mtimeNs), ctime: String(state.ctimeNs),
      bytes: state.isFile() ? (await readFile(path)).toString('base64') : null };
    if (state.isDirectory()) for (const name of await readdir(path)) await walk(join(path, name));
  }
  await walk(root);
  return result;
}

test('adoption, replacement merge and literal append preserve metadata meanings, comments, BOM, CRLF and mode', async t => {
  const { root, vault } = await fixture(t);
  const text = '\uFEFF---\r\n# Custom comment\r\ntitle: Existing # title comment\r\ncreated: 2020-01-02\r\ncustom: +09007199254740993 # big\r\nexponent: 1e3\r\nflag: TRUE\r\nnone: ~\r\nquoted: "123"\r\nescaped: "\\u0031"\r\ndate: 2026-11-02\r\nnested: {a: [1, false]}\r\n---\r\n# Old';
  await writeFile(join(root, 'note.md'), text);
  await chmod(join(root, 'note.md'), 0o640);
  const old = await readNote(vault, 'note.md');
  const replaced = await mutate(vault, { path: 'note.md', content: '---\nnone: null\n# supplied comment\nadded: yes\n---\n# New\n', expected_version: old.data.content_version }, false, now);
  assert.equal(replaced.current_version, old.data.content_version);
  const note = await readNote(vault, 'note.md');
  assert.equal(note.data.metadata.title, 'Existing');
  assert.equal(note.data.metadata.created, '2020-01-02');
  assert.equal(note.data.metadata.updated, now().toISOString());
  assert.deepEqual(note.data.metadata.tags, []);
  assert.equal(note.data.metadata.custom, '+09007199254740993');
  assert.equal(note.data.metadata.exponent, 1000);
  assert.equal(note.data.metadata.flag, true);
  assert.equal(note.data.metadata.none, null);
  assert.equal(note.data.metadata.quoted, '123');
  assert.equal(note.data.metadata.date, '2026-11-02');
  assert.equal(note.data.metadata.added, 'yes');
  assert.ok(note.data.content.startsWith('\uFEFF---\r\n'));
  for (const retained of ['# Custom comment', '# supplied comment', '# title comment', 'custom: +09007199254740993 # big', 'exponent: 1e3', 'flag: TRUE', 'quoted: "123"', 'escaped: "\\u0031"']) assert.ok(note.data.content.includes(retained), retained);
  assert.ok(!/(?<!\r)\n/.test(note.data.content));
  assert.equal((await lstat(join(root, 'note.md'))).mode & 0o777, 0o640);
  await mutate(vault, { path: 'note.md', content: '---\ntitle: Literal\n---\nTail' }, true, now);
  const appended = await readNote(vault, 'note.md');
  assert.equal(appended.data.metadata.title, 'Existing');
  assert.ok(appended.data.content.endsWith('# New\r\n---\r\ntitle: Literal\r\n---\r\nTail'));
  const created = await mutate(vault, { path: 'new/deep.md', content: '# Heading\nbody' }, false, now);
  assert.equal(created.current_version, null);
  assert.equal(await readFile(join(root, 'new/deep.md'), 'utf8'), '---\ntitle: Heading\ncreated: 2026-11-02T12:34:56.000Z\nupdated: 2026-11-02T12:34:56.000Z\ntags: []\n---\n# Heading\nbody');
  await mutate(vault, { path: 'new/deep.md', content: 'tail' }, true, now);
  assert.ok((await readFile(join(root, 'new/deep.md'), 'utf8')).endsWith('body\ntail'));
});

test('exclusive create, stale/deleted replacements, links, exact paths and invalid YAML refuse safely', async t => {
  const { root, scratch, vault } = await fixture(t);
  await writeFile(join(root, 'note.md'), 'original');
  const version = (await readNote(vault, 'note.md')).data.content_version;
  await rejects(() => mutate(vault, { path: 'note.md', content: 'new' }), 'CONFLICT');
  await rejects(() => mutate(vault, { path: 'note.md', content: 'new', expected_version: '0'.repeat(64) }), 'CONFLICT');
  await rm(join(root, 'note.md'));
  await rejects(() => mutate(vault, { path: 'note.md', content: 'new', expected_version: version }), 'CONFLICT');
  await rejects(() => mutate(vault, { path: 'missing/append.md', content: 'new' }, true), 'NOT_FOUND');
  await symlink(join(scratch, 'absent'), join(root, 'dangling.md'));
  await rejects(() => mutate(vault, { path: 'dangling.md', content: 'new' }), 'CONFLICT');
  await symlink(scratch, join(root, 'alias'));
  await rejects(() => mutate(vault, { path: 'alias/out.md', content: 'new' }), 'UNSAFE_PATH');
  await writeFile(join(root, 'hard.md'), 'original');
  await link(join(root, 'hard.md'), join(root, 'other.md'));
  await rejects(() => mutate(vault, { path: 'hard.md', content: 'new' }, true), 'UNSAFE_PATH');
  for (const path of ['/abs.md', '../out.md', '.hidden/a.md', 'a//b.md', 'a/./b.md', 'a\\b.md', 'a.txt']) await rejects(() => mutate(vault, { path, content: 'new' }), 'VALIDATION_ERROR');
  for (const yaml of ['title: 1', 'created: yesterday', 'updated: null', 'tags: nope', 'custom: !unknown a', 'a: [', 'a: 1\na: 2', 'a: &a [*a]', 'a: .inf']) {
    const text = `---\n${yaml}\n---\noriginal`;
    await writeFile(join(root, 'invalid.md'), text);
    await rejects(() => mutate(vault, { path: 'invalid.md', content: 'tail' }, true), 'VALIDATION_ERROR');
    await rejects(async () => mutate(vault, { path: 'invalid.md', content: '# Replacement', expected_version: (await readNote(vault, 'invalid.md')).data.content_version }), 'VALIDATION_ERROR');
    await rejects(() => mutate(vault, { path: 'new.md', content: text }), 'VALIDATION_ERROR');
    assert.equal(await readFile(join(root, 'invalid.md'), 'utf8'), text);
  }
  assert.ok(!(await readdir(root)).some(name => name.endsWith('.tmp')));
});

test('dry-run returns full before/after and versions with no filesystem changes, including absent external cache', async t => {
  const { root, scratch } = await fixture(t);
  const external = join(scratch, 'absent/cache');
  const vault = await selectVault({ vault: root, indexDir: external }, true);
  const before = await snapshot(scratch);
  const preview = await mutate(vault, { path: 'new/child.md', content: '# Preview', dry_run: true }, false, now);
  assert.equal(preview.file_written, false);
  assert.equal(preview.current_version, null);
  assert.equal(preview.diff.before, '');
  assert.match(preview.diff.after, /created: 2026-11-02T12:34:56.000Z/);
  assert.deepEqual(await snapshot(scratch), before);
  await writeFile(join(root, 'current.md'), 'original');
  const current = (await readNote(vault, 'current.md')).data.content_version;
  const existing = await snapshot(scratch);
  const replacement = await operate(vault, 'write', { path: 'current.md', content: 'replacement', expected_version: current, dry_run: true });
  assert.equal(replacement.data.diff.before, 'original');
  assert.equal(replacement.data.current_version, current);
  assert.match(replacement.data.diff.after, /replacement$/);
  assert.deepEqual(await snapshot(scratch), existing);
  const cli = await run(t, ['--vault', root, '--index-dir', external, 'write', 'new/cli.md', '--file', '-', '--dry-run', '--json'], scratch);
  assert.equal(cli.code, 0, cli.stdout + cli.stderr);
  assert.deepEqual(await snapshot(scratch), existing);
});

test('close-to-publish content changes conflict, failures remove owned temporary files', async t => {
  const { root, vault } = await fixture(t);
  await writeFile(join(root, 'note.md'), 'before');
  const original = fs.open;
  let changed = false;
  const mock = t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('.tmp')) {
      changed = true;
      await writeFile(join(root, 'note.md'), 'external editor');
    }
    return handle;
  });
  syncBuiltinESMExports();
  try { await rejects(() => mutate(vault, { path: 'note.md', content: 'append' }, true, now), 'CONFLICT'); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(changed, true);
  assert.equal(await readFile(join(root, 'note.md'), 'utf8'), 'external editor');
  assert.deepEqual((await readdir(root)).sort(), ['.mdwiki', 'note.md']);
});

test('CLI file/stdin writes, concurrent exclusive creates and different-cache appends share serialization', async t => {
  const { root, scratch } = await fixture(t);
  const file = join(scratch, 'input.txt');
  await writeFile(file, '# CLI');
  const args = ['--vault', root, 'write', 'same.md', '--file', file, '--json'];
  const creates = await Promise.all([run(t, args, scratch), run(t, args, scratch)]);
  assert.deepEqual(creates.map(r => r.code).sort(), [0, 4]);
  for (const result of creates) assert.equal(result.stderr, '');
  const appends = ['first', 'second'].map((text, i) => {
    const process = start(t, ['append', 'same.md', '--file', '-', '--index-dir', join(scratch, `cache-${i}`), '--vault', root, '--json'], scratch);
    process.child.stdin.end(text);
    return process.closed;
  });
  for (const result of await Promise.all(appends)) assert.equal(result.code, 0, result.stdout + result.stderr);
  const content = await readFile(join(root, 'same.md'), 'utf8');
  assert.equal(content.split('first').length, 2);
  assert.equal(content.split('second').length, 2);
  const read = JSON.parse((await run(t, ['read', 'same.md', '--vault', root, '--json'], scratch)).stdout);
  const replaced = await run(t, [...args, '--expected-version', read.data.content_version], scratch);
  assert.equal(replaced.code, 0, replaced.stdout);
  assert.equal((await run(t, [...args, '--expected-version', read.data.content_version], scratch)).code, 4);
  await rm(join(root, 'same.md'));
  assert.equal((await run(t, [...args, '--expected-version', read.data.content_version], scratch)).code, 4);
});

async function peerSession(t, root) {
  const peer = protocol(t, root);
  assert.equal((await peer.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'writes', version: '1' } })).error, undefined);
  peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 2;
  return { peer, call: async (name, args) => {
    const response = await peer.request(id++, 'tools/call', { name: 'mdwiki_' + name, arguments: args });
    assert.equal(response.error, undefined);
    assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
    return response.result.structuredContent;
  } };
}

test('MCP previews do not mutate startup state; writes share envelopes and report post-publication index failure', async t => {
  const { root, scratch } = await fixture(t);
  // Persisted external cache may vanish before a preview-only process starts.
  const second = join(scratch, 'second');
  const external = join(scratch, 'external');
  await mkdir(second);
  await initVault({ vault: second, indexDir: external });
  await rm(external, { recursive: true });
  await writeFile(join(second, 'existing.md'), 'read-only session');
  const before = await snapshot(scratch);
  const { peer, call } = await peerSession(t, second);
  assert.equal((await call('list', {})).data.entries.length, 1);
  assert.equal((await call('tree', {})).data.entries.length, 1);
  assert.equal((await call('read', { path: 'existing.md' })).data.content, 'read-only session');
  assert.equal((await call('write', { path: 'nested/new.md', content: '# Preview', dry_run: true })).data.file_written, false);
  assert.deepEqual(await snapshot(scratch), before);
  for (const [name, args] of [['write', { path: 'x.md' }], ['append', { path: 'x.md', content: 4 }], ['write', { path: 'x.md', content: 'x', expected_version: 'bad' }]]) assert.equal((await call(name, args)).error.code, 'VALIDATION_ERROR');
  const created = await call('write', { path: 'new.md', content: '# Created' });
  assert.equal(created.data.file_written, true);
  assert.equal(created.data.index.ok, true);
  assert.equal((await call('write', { path: 'new.md', content: 'x' })).error.code, 'CONFLICT');
  assert.equal((await call('write', { path: 'missing.md', content: 'x', expected_version: created.data.content_version })).error.code, 'CONFLICT');
  const [one, two] = await Promise.all([call('append', { path: 'new.md', content: 'one' }), call('append', { path: 'new.md', content: 'two' })]);
  assert.equal(one.ok, true); assert.equal(two.ok, true);
  await rm(join(external, 'index.sqlite'));
  await mkdir(join(external, 'index.sqlite'));
  const failed = await call('append', { path: 'new.md', content: 'published' });
  assert.equal(failed.ok, true); assert.equal(failed.degraded, true);
  assert.equal(failed.data.file_written, true); assert.equal(failed.data.index.ok, false);
  assert.equal(failed.data.content_version, (await call('read', { path: 'new.md' })).data.content_version);
  assert.ok((await readFile(join(second, 'new.md'), 'utf8')).endsWith('published'));
  peer.child.stdin.end(); assert.equal((await peer.closed).code, 0); peer.assertClean();
  // CLI has the same partial-success result and exit 6.
  await writeFile(join(root, 'note.md'), 'original');
  await mkdir(join(root, '.mdwiki/index.sqlite'));
  const process = start(t, ['--vault', root, 'append', 'note.md', '--file', '-', '--json'], scratch);
  process.child.stdin.end('once');
  const result = await process.closed;
  assert.equal(result.code, 6, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.data.file_written, true); assert.equal(data.data.index.ok, false);
  assert.equal(data.diagnostics[0].code, 'INDEX_UPDATE_FAILED');
});


test('live mutation coordinator is never stolen; process death releases it without stale cleanup', async t => {
  const { root, scratch, vault } = await fixture(t);
  await writeFile(join(root, 'note.md'), 'base');
  const module = pathToFileURL(join(core, 'core/coordinator.js')).href;
  const selection = pathToFileURL(join(core, 'core/vault.js')).href;
  const code = `import { coordinate } from ${JSON.stringify(module)};
    import { selectVault } from ${JSON.stringify(selection)};
    const vault = await selectVault({vault: ${JSON.stringify(root)}}, true);
    await coordinate({...vault,indexDir: ${JSON.stringify(join(root, '.mdwiki'))}}, 'mutations.sqlite', async () => {
      process.stdout.write('locked\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));
    });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  t.after(async () => { clearTimeout(timer); child.kill('SIGKILL'); await closed; });
  const [signal] = await once(child.stdout, 'data');
  assert.equal(signal.toString(), 'locked\n');
  const lockPath = join(root, '.mdwiki/mutations.sqlite');
  const identity = await lstat(lockPath);
  // A separate SQLite contender with timeout=0 proves the live inode is locked.
  const { DatabaseSync } = await import('node:sqlite');
  const contender = new DatabaseSync(lockPath);
  try { assert.throws(() => contender.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'), /locked/); }
  finally { contender.close(); }
  const writer = start(t, ['--vault', root, '--index-dir', join(scratch, 'other-cache'), 'append', 'note.md', '--file', '-', '--json'], scratch);
  writer.child.stdin.end('after crash');
  child.kill('SIGKILL');
  await closed; clearTimeout(timer);
  const result = await writer.closed;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await lstat(lockPath)).ino, identity.ino);
  assert.ok((await readNote(vault, 'note.md')).data.content.endsWith('base\nafter crash'));
});

test('bounds cover input bytes, resulting adopted note, invalid Unicode and full preview diff', async t => {
  const { vault, scratch, root } = await fixture(t);
  const limit = 10 * 1024 * 1024;
  await rejects(() => mutate(vault, { path: 'x.md', content: 'é'.repeat(limit / 2 + 1), dry_run: true }), 'SIZE_LIMIT');
  await rejects(() => mutate(vault, { path: 'x.md', content: 'x'.repeat(limit), dry_run: true }), 'SIZE_LIMIT');
  await rejects(() => mutate(vault, { path: 'x.md', content: '\uD800', dry_run: true }), 'INVALID_UTF8');
  const text = 'x'.repeat(limit - 1024);
  const preview = await mutate(vault, { path: 'x.md', content: text, dry_run: true }, false, now);
  assert.ok(preview.diff.after.endsWith(text));
  const invalid = join(scratch, 'invalid.bin');
  await writeFile(invalid, Buffer.from([0xc3, 0x28]));
  const result = await run(t, ['--vault', root, 'write', 'x.md', '--file', invalid, '--json'], scratch);
  assert.equal(result.code, 2); assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_UTF8');
  const { peer, call } = await peerSession(t, root);
  // >10 MiB on the wire, but <10 MiB body bytes: exercises SDK framing headroom.
  const large = '\\'.repeat(5 * 1024 * 1024 + 1);
  const response = await call('write', { path: '../big.md', content: large, dry_run: true });
  assert.equal(response.error.code, 'VALIDATION_ERROR');
  assert.equal((await call('write', { path: 'small.md', content: '# Still usable', dry_run: true })).ok, true);
  peer.child.stdin.end(); assert.equal((await peer.closed).code, 0);
});

test('real CLI/MCP replacements preserve comments, custom metadata, BOM and CRLF; stale versions and missing appends fail', async t => {
  const { root, scratch } = await fixture(t);
  const raw = '\uFEFF---\r\n# comment\r\ncustom: +09007199254740993 # lexical\r\ncreated: 2020-01-02\r\n---\r\n# Original';
  await writeFile(join(root, 'note.md'), raw);
  const input = join(scratch, 'replacement.txt'); await writeFile(input, '# CLI body');
  const read = JSON.parse((await run(t, ['--vault', root, 'read', 'note.md', '--json'], scratch)).stdout);
  const result = await run(t, ['--vault', root, 'write', 'note.md', '--file', input, '--expected-version', read.data.content_version, '--json'], scratch);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { peer, call } = await peerSession(t, root);
  const current = await call('read', { path: 'note.md' });
  assert.equal((await call('write', { path: 'note.md', content: '# stale', expected_version: read.data.content_version })).error.code, 'CONFLICT');
  const replaced = await call('write', { path: 'note.md', content: '---\nadded: null\n---\n# MCP body', expected_version: current.data.content_version });
  assert.equal(replaced.ok, true);
  assert.equal((await call('append', { path: 'absent.md', content: 'tail' })).error.code, 'NOT_FOUND');
  const note = await call('read', { path: 'note.md' });
  assert.equal(note.data.metadata.custom, '+09007199254740993');
  assert.equal(note.data.metadata.added, null); assert.equal(note.data.metadata.created, '2020-01-02');
  assert.equal(note.data.metadata.title, 'CLI body');
  assert.ok(note.data.content.startsWith('\uFEFF---\r\n'));
  assert.ok(note.data.content.includes('# comment\r\ncustom: +09007199254740993 # lexical\r\n'));
  assert.ok(note.data.content.endsWith('# MCP body')); assert.ok(!/(?<!\r)\n/.test(note.data.content));
  peer.child.stdin.end(); assert.equal((await peer.closed).code, 0); peer.assertClean();
});

test('publication failures clean temps; failures after exclusive publication retain file success/version', async t => {
  const { root, vault } = await fixture(t);
  for (const method of ['link', 'rename']) {
    await writeFile(join(root, 'existing.md'), 'before');
    const mock = t.mock.method(fs, method, async () => { throw Object.assign(new Error('fixture I/O failure'), { code: 'EIO' }); });
    syncBuiltinESMExports();
    try {
      await rejects(() => mutate(vault, { path: method === 'link' ? 'new.md' : 'existing.md', content: 'after' }, method === 'rename', now), 'OPERATIONAL_ERROR');
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await readFile(join(root, 'existing.md'), 'utf8'), 'before');
    assert.ok(!(await readdir(root)).some(name => name.endsWith('.tmp')));
  }
  const unlink = fs.unlink;
  let failed = false;
  const mock = t.mock.method(fs, 'unlink', async (...args) => {
    if (!failed && String(args[0]).endsWith('.tmp')) { failed = true; throw new Error('fixture cleanup failure'); }
    return unlink(...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await operate(vault, 'write', { path: 'published.md', content: '# Published' });
    assert.equal(result.ok, true); assert.equal(result.degraded, true); assert.equal(result.data.file_written, true);
    assert.equal(result.data.content_version, (await readNote(vault, 'published.md')).data.content_version);
    assert.equal(result.diagnostics[0].code, 'PUBLICATION_CLEANUP_FAILED');
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.ok(!(await readdir(root)).some(name => name.endsWith('.tmp')));
});

test('safe YAML aliases survive adoption; anchor merges cannot reinterpret omitted metadata', async t => {
  const { root, vault } = await fixture(t);
  const raw = '---\ncustom: &label "Original"\ncopy: *label\ntitle: *label\nupdated: 2020-01-01 # retain update comment\n---\nbody';
  await writeFile(join(root, 'aliases.md'), raw);
  await mutate(vault, { path: 'aliases.md', content: 'tail' }, true, now);
  const note = await readNote(vault, 'aliases.md');
  assert.equal(note.data.metadata.copy, 'Original'); assert.equal(note.data.metadata.title, 'Original');
  assert.equal(note.data.metadata.updated, now().toISOString());
  assert.ok(note.data.content.includes('# retain update comment'));
  const bytes = note.data.content;
  await rejects(() => mutate(vault, { path: 'aliases.md', content: '---\ncustom: &label Changed\n---\nreplacement', expected_version: note.data.content_version }, false, now), 'VALIDATION_ERROR');
  await rejects(() => mutate(vault, { path: 'aliases.md', content: '---\ncustom: Changed\n---\nreplacement', expected_version: note.data.content_version }, false, now), 'VALIDATION_ERROR');
  assert.equal(await readFile(join(root, 'aliases.md'), 'utf8'), bytes);
});

test('mutations preserve native physical case/Unicode distinctions and refuse alias spellings on insensitive filesystems', async t => {
  const { root, vault } = await fixture(t);
  for (const [first, second] of [['A.md', 'a.md'], ['é.md', 'e\u0301.md']]) {
    await writeFile(join(root, first), '# Existing');
    const initial = await readdir(root);
    let aliased = false;
    try { await lstat(join(root, second)); aliased = !initial.includes(second); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (aliased) await rejects(() => mutate(vault, { path: second, content: '# New' }, false, now), 'CONFLICT');
    else {
      await mutate(vault, { path: second, content: '# New' }, false, now);
      assert.ok((await readdir(root)).includes(second));
      assert.equal(await readFile(join(root, first), 'utf8'), '# Existing');
    }
  }
});

test('a paused real mutation excludes a different-cache contender and the retry appends latest bytes', async t => {
  const { root, scratch, vault } = await fixture(t);
  await writeFile(join(root, 'note.md'), 'base');
  const mutations = pathToFileURL(join(core, 'core/mutations.js')).href;
  const selection = pathToFileURL(join(core, 'core/vault.js')).href;
  const code = `import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { mutate } from ${JSON.stringify(mutations)};
    import { selectVault } from ${JSON.stringify(selection)};
    const original = fs.open;
    fs.open = async (...args) => {
      if (String(args[0]).endsWith('.tmp')) {
        process.stdout.write('prepared\\n');
        await new Promise(resolve => process.stdin.once('data', resolve));
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    const vault = await selectVault({vault: ${JSON.stringify(root)},indexDir: ${JSON.stringify(join(scratch, 'cache-one'))}}, true);
    await mutate(vault, {path:'note.md',content:'first'}, true);
    process.stdin.pause();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  t.after(async () => { clearTimeout(timer); child.kill('SIGKILL'); await closed; });
  assert.equal((await once(child.stdout, 'data'))[0].toString(), 'prepared\n');
  const second = await selectVault({ vault: root, indexDir: join(scratch, 'cache-two') }, true);
  const { DatabaseSync } = await import('node:sqlite');
  const exec = DatabaseSync.prototype.exec;
  // Replace only wait duration, so contention is a deterministic immediate error.
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    return exec.call(this, sql.replace('busy_timeout=5000', 'busy_timeout=0'));
  });
  try { await rejects(() => mutate(second, { path: 'note.md', content: 'second' }, true, now), 'OPERATIONAL_ERROR'); }
  finally { mock.mock.restore(); }
  assert.equal(await readFile(join(root, 'note.md'), 'utf8'), 'base');
  child.stdin.end('publish');
  assert.equal((await closed)[0], 0, stderr); clearTimeout(timer);
  await mutate(second, { path: 'note.md', content: 'second' }, true, now);
  assert.ok((await readNote(vault, 'note.md')).data.content.endsWith('base\nfirst\nsecond'));
});
