import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { run, protocol } from './process-helpers.mjs';
const core = process.env.MDWIKI_TEST_CORE ?? new URL('../dist/', import.meta.url).pathname;
const { initVault, selectVault } = await import(pathToFileURL(join(core, 'core/vault.js')));
const { operate } = await import(pathToFileURL(join(core, 'operations.js')));
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'mdwiki-search-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const vault = join(cwd, 'vault');
  await mkdir(vault);
  await initVault({ vault, indexDir: join(cwd, 'cache') });
  const selected = await selectVault({ vault });
  const put = (path, content) => writeFile(join(vault, path), content);
  const search = (query, options = {}) => operate(selected, 'search', { query, ...options });
  return { cwd, vault, selected, put, search, dbPath: join(cwd, 'cache/index.sqlite') };
}
const paths = (result) => result.data.entries.map((entry) => entry.path);

test('searches matching fields, safe nested lexical values, AND phrases, punctuation, exact tags and useful excerpts', async (t) => {
  const { put, search } = await fixture(t);
  await put('a.md', '---\ntitle: Needle\ntags: [Exact, Second]\nsecretkey: {nestedkey: [9007199254740993, true, null, "123", 2026-11-02, 0xFF, 1.20]}\n---\nred quick fox jumps\n');
  await put('b.md', '# Other\nneedle red quick fox\n');
  await put('c.md', '# Other\nneedle red scattered quick scattered fox\n');
  await put('pathmarker.md', '# Other\nplain');
  assert.equal(paths(await search('needle'))[0], 'a.md');
  assert.deepEqual(paths(await search('red "quick fox"')).sort(), ['a.md', 'b.md']);
  assert.deepEqual(paths(await search('quick fox')).sort(), ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(paths(await search('red:quick-fox*')).sort(), ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(paths(await search('quick OR absent')), []);
  for (const term of ['9007199254740993', 'true', '123', '2026-11-02', '0xFF', '1.20']) {
    const result = await search(term);
    assert.deepEqual(paths(result), ['a.md'], term);
    assert.ok(result.data.entries[0].excerpt.toLowerCase().includes(term.toLowerCase()), term);
    assert.ok(result.data.entries[0].excerpt.length <= 512);
  }
  for (const term of ['secretkey', 'nestedkey', 'null']) assert.deepEqual(paths(await search(term)), []);
  assert.match((await search('pathmarker')).data.entries[0].excerpt, /pathmarker/);
  assert.deepEqual(paths(await search('needle', { tags: ['Exact', 'Second', 'Exact'] })), ['a.md']);
  assert.deepEqual(paths(await search('needle', { tags: ['exact'] })), []);
  assert.deepEqual(paths(await search('needle', { tags: ['Exact', 'Missing'] })), []);
  await put('long.md', '# Long\n' + 'x'.repeat(4000) + ' tailmatch ' + 'y'.repeat(4000));
  const excerpt = (await search('tailmatch')).data.entries[0].excerpt;
  assert.match(excerpt, /tailmatch/);
  assert.ok(excerpt.length <= 484);
  await put('fallback.md', '---\nrawkey: [broken\n---\nfallbackword');
  const fallback = await search('rawkey');
  assert.deepEqual(paths(fallback), ['fallback.md']);
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.diagnostics[0].code, 'INVALID_FRONTMATTER');
  for (const query of ['', '   ', '!!!', '""', '"unterminated', 'foo "', '"!!!" foo', Array(129).fill('word').join(' ')]) {
    await assert.rejects(() => search(query), (error) => error.code === 'VALIDATION_ERROR', query);
  }
});

test('content hashes skip unchanged FTS writes, detect restored-mtime edits and bind all cursor dimensions', async (t) => {
  const { vault, selected, put, search, dbPath, cwd } = await fixture(t);
  await put('a.md', '# Same\ncommon oldword');
  await put('b.md', '# Same\ncommon oldword');
  let result = await search('common', { limit: 1 });
  assert.deepEqual(paths(result), ['a.md']);
  const cursor = result.data.next_cursor;
  const generation = result.data.generation;
  // Reject accidental FTS reinsertion; an unchanged sync must succeed anyway.
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TRIGGER reject_reparse BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'unchanged note reindexed'); END");
  assert.equal((await operate(selected, 'reindex', {})).data.unchanged, 2);
  db.exec('DROP TRIGGER reject_reparse'); db.close();
  assert.deepEqual(paths(await search('common', { limit: 1, cursor })), ['b.md']);
  assert.equal((await search('common')).data.generation, generation);
  for (const options of [{ query: 'oldword', limit: 1 }, { query: 'common', limit: 2 }, { query: 'common', limit: 1, tags: ['tag'] }]) {
    await assert.rejects(() => operate(selected, 'search', { ...options, cursor }), (error) => error.code === 'VALIDATION_ERROR');
  }
  const other = join(cwd, 'other'); await mkdir(other); await initVault({ vault: other });
  await assert.rejects(async () => operate(await selectVault({ vault: other }), 'search', { query: 'common', limit: 1, cursor }), (error) => error.code === 'VALIDATION_ERROR');
  const before = await stat(join(vault, 'a.md'));
  await put('a.md', '# Same\ncommon newword');
  await utimes(join(vault, 'a.md'), before.atime, before.mtime);
  result = await search('newword');
  assert.deepEqual(paths(result), ['a.md']);
  assert.notEqual(result.data.generation, generation);
  await assert.rejects(() => search('common', { limit: 1, cursor }), (error) => error.code === 'VALIDATION_ERROR');
  await rm(join(vault, 'b.md'));
  assert.deepEqual(paths(await search('oldword')), []);
  await put('z.md', '# Same\ncommon newword');
  assert.deepEqual(paths(await search('newword')), ['a.md', 'z.md']);
});

test('unreadable current bytes remove stale hits, retain diagnostics, and recover on next sync', async (t) => {
  const { vault, put, search } = await fixture(t);
  await put('a.md', '# Current\nstalecontent');
  assert.deepEqual(paths(await search('stalecontent')), ['a.md']);
  const original = fs.open;
  const mock = t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(vault, 'a.md')) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await search('stalecontent');
    assert.deepEqual(paths(result), []);
    assert.equal(result.degraded, true);
    assert.deepEqual(result.diagnostics.map((d) => [d.path, d.code]), [['a.md', 'UNREADABLE_NOTE']]);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(paths(await search('stalecontent')), ['a.md']);
});

test('SQL batch failure rolls back all changed notes before a later retry', async (t) => {
  const { selected, put, search, dbPath } = await fixture(t);
  await put('a.md', 'oldcontent'); await put('b.md', 'oldcontent');
  await search('oldcontent');
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON notes WHEN new.path='b.md' BEGIN SELECT RAISE(ABORT, 'controlled failure'); END");
  await put('a.md', 'newcontent'); await put('b.md', 'newcontent');
  await assert.rejects(() => operate(selected, 'reindex', {}), (e) => e.code === 'OPERATIONAL_ERROR');
  assert.equal(db.prepare("SELECT count(*) AS count FROM documents WHERE documents MATCH 'oldcontent'").get().count, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM documents WHERE documents MATCH 'newcontent'").get().count, 0);
  db.exec('DROP TRIGGER fail_second'); db.close();
  assert.deepEqual(paths(await search('newcontent')), ['a.md', 'b.md']);
});

test('failed discovery preserves committed cache and full rebuild refuses partial publication', async (t) => {
  const { vault, selected, put, search, dbPath } = await fixture(t);
  await put('a.md', 'original'); await search('original');
  const bytes = await readFile(dbPath);
  const original = fs.readdir;
  const mock = t.mock.method(fs, 'readdir', async (path, ...args) => {
    if (path === vault) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return original(path, ...args);
  }); syncBuiltinESMExports();
  try {
    await assert.rejects(() => operate(selected, 'reindex', { full: true }), (e) => e.code === 'OPERATIONAL_ERROR');
    assert.deepEqual(await readFile(dbPath), bytes);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(paths(await search('original')), ['a.md']);
});

test('installed CLI and initialized MCP reconcile external edits, page, validate and rebuild corrupt/incompatible cache', async (t) => {
  const { cwd, vault, put, dbPath, selected } = await fixture(t);
  const raw = '---\ntitle: Fixture\ntags: [One, Two]\n---\nsearchable phrase\n';
  await put('a.md', raw); await put('b.md', raw);
  async function cli(args, code = 0) {
    const result = await run(t, ['--vault', vault, '--index-dir', selected.indexDir, ...args, '--json'], cwd);
    assert.equal(result.code, code, result.stdout + result.stderr);
    assert.equal(result.stderr, ''); return JSON.parse(result.stdout);
  }
  assert.equal((await cli(['reindex'])).data.added, 2);
  const first = await cli(['search', '"searchable phrase"', '--tag', 'One', '--tag', 'Two', '--limit', '1']);
  assert.deepEqual(paths(first), ['a.md']);
  assert.deepEqual(paths(await cli(['search', '"searchable phrase"', '--tag', 'One', '--tag', 'Two', '--limit', '1', '--cursor', first.data.next_cursor])), ['b.md']);
  for (const args of [['search', '"bad'], ['search', '!!!'], ['search', 'x', '--limit', '201'], ['reindex', '--tag', 'One'], ['read', 'a.md', '--full']]) await cli(args, 2);
  const peer = protocol(t, vault);
  assert.equal((await peer.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'search-test', version: '1' } })).error, undefined);
  peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 2;
  const call = async (name, args) => (await peer.request(id++, 'tools/call', { name: 'mdwiki_' + name, arguments: args })).result;
  assert.deepEqual((await call('search', { query: 'searchable', tags: ['One', 'Two'] })).structuredContent, await cli(['search', 'searchable', '--tag', 'One', '--tag', 'Two']));
  await put('a.md', '# External\nupdatedtext');
  assert.deepEqual(paths((await call('search', { query: 'updatedtext' })).structuredContent), ['a.md']);
  for (const args of [{ query: 42 }, { query: 'x', tags: 'One' }, { query: 'x', tags: [42] }, { query: 'x', cursor: 42 }, { query: 'x', vault }]) {
    assert.equal((await call('search', args)).structuredContent.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await call('reindex', { full: 'yes' })).isError, true);
  assert.equal((await call('reindex', { full: true })).structuredContent.ok, true);
  await writeFile(dbPath, 'corrupt cache');
  const broken = await cli(['search', 'updatedtext'], 5);
  assert.ok(broken.error.message.includes(dbPath)); assert.match(broken.error.message, /reindex --full/);
  assert.equal((await call('search', { query: 'updatedtext' })).isError, true);
  await writeFile(dbPath + '-wal', 'stale WAL'); await writeFile(dbPath + '-shm', 'stale SHM');
  await cli(['reindex', '--full']);
  assert.deepEqual(paths((await call('search', { query: 'updatedtext' })).structuredContent), ['a.md']);
  let db = new DatabaseSync(dbPath); db.exec('PRAGMA user_version=999'); db.close();
  await cli(['reindex'], 5);
  // Two real cooperating processes serialize full publication, including WAL cleanup.
  await Promise.all([cli(['reindex', '--full']), cli(['reindex', '--full'])]);
  assert.deepEqual(paths(await cli(['search', 'updatedtext'])), ['a.md']);
  await rm(dbPath); assert.equal((await cli(['reindex'])).data.added, 2);
  assert.equal(await readFile(join(vault, 'b.md'), 'utf8'), raw);
  const target = join(cwd, 'sentinel'); await writeFile(target, 'safe');
  await rm(dbPath); await symlink(target, dbPath);
  assert.equal((await cli(['reindex', '--full'], 2)).error.code, 'UNSAFE_PATH');
  assert.equal(await readFile(target, 'utf8'), 'safe');
  peer.child.stdin.end(); assert.equal((await peer.closed).code, 0); peer.assertClean();
});
