import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { run, protocol } from './process-helpers.mjs';
const core = process.env.MDWIKI_TEST_CORE ?? new URL('../dist/', import.meta.url).pathname;
const load = (path) => import(pathToFileURL(join(core, path)));
const { initVault, selectVault } = await load('core/vault.js');
const { operate } = await load('operations.js');
const { frontmatter } = await load('core/frontmatter.js');
const { parseLinks, linkResolver } = await load('core/links.js');
async function fixture(t) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'mdwiki-links-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const vault = join(cwd, 'vault'); await mkdir(vault);
  await initVault({ vault, indexDir: join(cwd, 'cache') });
  const selected = await selectVault({ vault });
  const put = async (path, content) => { await mkdir(join(vault, path, '..'), { recursive: true }); await writeFile(join(vault, path), content); };
  const backlinks = (path, options = {}) => operate(selected, 'backlinks', { path, ...options });
  return { cwd, vault, selected, put, backlinks, dbPath: join(cwd, 'cache/index.sqlite') };
}

test('parses original link positions and excludes Markdown code, HTML, YAML and attachment embeds', () => {
  const content = '\uFEFF---\r\nlookalike: "[[YAML]]"\r\n---\r\n' +
    '[[Note]] [[Note|label]] [[Note#Heading]] [[#^block]] ![[Note.md#x|label]] ![[image.png]]\n' +
    '`[[inline]]` ``a ` [[inline2]]`` <!-- [[comment]]\n[[comment2]] -->\n' +
    '```js\n[[fenced]]\n```\n~~~\n[[tilde]]\n~~~\n    [[indented]]\n' +
    '> ```\n> [[quoted code]]\n> ```\n- code:\n\n      [[list code]]\n\n\\[[escaped]]\n[[After]]';
  const links = parseLinks(content);
  assert.deepEqual(links.map((l) => l.target), ['Note', 'Note', 'Note', '', 'Note.md', 'After']);
  assert.equal(links[3].fragment, '^block'); assert.equal(links[4].embed, true);
  assert.equal(links[0].line, 4); assert.equal(links[0].column, 1);
  assert.equal(content.slice(links[0].offset, links[0].offset + 8), '[[Note]]');
  assert.deepEqual(parseLinks('---\n[[unclosed yaml]]'), []);
  assert.deepEqual(parseLinks('<div>[[Visible]]</div><!-- [[hidden]] -->').map((l) => l.target), ['Visible']);
  assert.deepEqual(parseLinks('> <!--\n' + '> comment\n'.repeat(20) + '> [[Hidden]]\n> -->\n[[Visible]]').map((l) => l.target), ['Visible']);
  assert.deepEqual(parseLinks('\n---\n[[Body]]').map((l) => l.target), ['Body']);
  for (const value of ['9007199254740993', '[9007199254740993]', '[one, 42]', 'null']) {
    assert.deepEqual(frontmatter(`---\naliases: ${value}\n---\n`, 'a.md').aliases, []);
  }
  assert.deepEqual(frontmatter('---\na: &text nickname\naliases: [*text]\n---\n', 'a.md').aliases, ['nickname']);
  assert.deepEqual(parseLinks('---\nx: [broken\n---\n[[Body]]').map((l) => l.target), ['Body']);
  assert.ok(parseLinks('[[' + 'x'.repeat(5000) + ']]')[0].context.length <= 320);
});

test('ordered resolver preserves exact spelling, diagnoses stages and refuses unsafe targets before aliases', () => {
  const resolve = linkResolver([
    { path: 'dir/Note.md', aliases: ['Root', '.hidden', '../escape'] },
    { path: 'Note.md', aliases: ['alias', 'duplicate'] },
    { path: 'other/Note.md', aliases: ['duplicate'] },
    { path: 'Root.md', aliases: [] }, { path: 'É.md', aliases: [] },
    { path: 'odd.MD', aliases: [] }, { path: 'odd.md', aliases: [] },
  ]);
  assert.equal(resolve('dir/Source.md', 'Note').resolved, 'dir/Note.md');
  assert.equal(resolve('dir/Source.md', 'Root').resolved, 'Root.md');
  assert.equal(resolve('dir/Source.md', 'alias').resolved, 'Note.md');
  assert.equal(resolve('dir/Source.md', '').resolved, 'dir/Source.md');
  assert.equal(resolve('Source.md', 'É').resolved, 'É.md');
  for (const target of ['é', 'E\u0301', 'note', 'odd.Md', 'absent']) assert.equal(resolve('Source.md', target).code, 'MISSING_LINK');
  assert.deepEqual(resolve('Source.md', 'duplicate').candidates, ['Note.md', 'other/Note.md']);
  assert.deepEqual(resolve('Source.md', 'odd').candidates, ['odd.MD', 'odd.md']);
  for (const target of ['../escape', '.hidden', '/Note', 'a//b', 'a/./b', 'a\\b', 'C:/Note']) assert.equal(resolve('Source.md', target).code, 'INVALID_LINK');
  const duplicateNames = linkResolver([{ path: 'a/Dup.md', aliases: [] }, { path: 'b/Dup.md', aliases: ['Dup'] }]);
  assert.deepEqual(duplicateNames('Source.md', 'Dup').candidates, ['a/Dup.md', 'b/Dup.md']);
});

test('graph reconciliation updates unchanged sources for paths/aliases, is atomic and rebuildable without note edits', async (t) => {
  const { vault, selected, put, backlinks, dbPath } = await fixture(t);
  const source = '[[Target]] [[nickname]] [[Dup]] [[#Heading]] ![[Target#^block]] [[../escape]] [[.hidden]]';
  await put('Source.md', source); await put('Target.md', '---\naliases: nickname\n---\n');
  let result = await backlinks('Target.md');
  assert.equal(result.data.entries.length, 3);
  assert.deepEqual(result.data.link_diagnostics.map((d) => d.code), ['MISSING_LINK', 'INVALID_LINK', 'INVALID_LINK']);
  assert.equal((await backlinks('Source.md')).data.entries.length, 1);
  const firstGeneration = result.data.generation;
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TRIGGER reject_source BEFORE INSERT ON notes WHEN new.path='Source.md' BEGIN SELECT RAISE(ABORT, 'source reparsed'); END");
  assert.equal((await backlinks('Target.md')).data.generation, firstGeneration);
  await put('Target.md', '---\naliases: [other]\n---\n');
  result = await backlinks('Target.md'); assert.equal(result.data.entries.length, 2);
  assert.ok(result.data.link_diagnostics.some((d) => d.occurrence.target === 'nickname'));
  await put('a/Dup.md', '---\naliases: [nickname]\n---\n');
  assert.equal((await backlinks('a/Dup.md')).data.entries.length, 2);
  await put('b/Dup.md', '---\naliases: [nickname]\n---\n');
  result = await backlinks('Target.md');
  for (const target of ['Dup', 'nickname']) assert.deepEqual(result.data.link_diagnostics.find((d) => d.occurrence.target === target).candidates, ['a/Dup.md', 'b/Dup.md']);
  await rename(join(vault, 'Target.md'), join(vault, 'Renamed.md'));
  assert.equal((await backlinks('Renamed.md')).data.entries.length, 0);
  await put('Target.md', 'replacement');
  db.exec("CREATE TRIGGER fail_graph BEFORE UPDATE ON links BEGIN SELECT RAISE(ABORT, 'controlled graph failure'); END");
  const generation = db.prepare('SELECT generation FROM state').get().generation;
  await assert.rejects(() => backlinks('Target.md'), (e) => e.code === 'OPERATIONAL_ERROR');
  assert.equal(db.prepare('SELECT generation FROM state').get().generation, generation);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notes WHERE path='Target.md'").get().n, 0);
  db.exec('DROP TRIGGER fail_graph; DROP TRIGGER reject_source'); db.close();
  assert.equal((await backlinks('Target.md')).data.entries.length, 2);
  await rm(join(vault, 'b/Dup.md'));
  assert.equal((await backlinks('a/Dup.md')).data.entries.length, 2);
  await operate(selected, 'reindex', { full: true });
  assert.equal((await backlinks('Target.md')).data.entries.length, 2);
  assert.equal(await readFile(join(vault, 'Source.md'), 'utf8'), source);
});

test('installed CLI and initialized MCP page identical bounded results, reject cursors/arguments and recover schema v2', async (t) => {
  const { cwd, vault, selected, put, backlinks, dbPath } = await fixture(t);
  await put('Target.md', '---\naliases: [nickname]\n---\n');
  await put('A.md', '[[Target]] [[missing]] [[nickname]] ![[Target#Heading]]');
  await put('B.md', '---\ncustom: "[[Target]]"\n---\n[[Target.md|label]] [[target]] [[../Target]] ![[photo.jpg]] `[[ignored]]`\n<!-- [[Target]] -->\n~~~\n[[Target]]\n~~~');
  async function cli(args, code = 0) {
    const result = await run(t, ['--vault', vault, ...args, '--json'], cwd);
    assert.equal(result.code, code, result.stdout + result.stderr); assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  }
  const expected = await backlinks('Target.md');
  assert.equal(expected.data.entries.length, 4); assert.equal(expected.data.link_diagnostics.length, 3);
  assert.deepEqual(await cli(['backlinks', 'Target.md']), expected);
  let page = await cli(['backlinks', 'Target.md', '--limit', '1']);
  const first = page.data.next_cursor; let count = 0;
  while (true) {
    count += page.data.entries.length + page.data.link_diagnostics.length;
    assert.equal(page.data.entries.length + page.data.link_diagnostics.length, 1);
    if (!page.data.next_cursor) break;
    page = await cli(['backlinks', 'Target.md', '--limit', '1', '--cursor', page.data.next_cursor]);
  }
  assert.equal(count, 7);
  for (const args of [['backlinks', 'Target.md', '--limit', '2', '--cursor', first], ['backlinks', 'A.md', '--limit', '1', '--cursor', first], ['backlinks', '../Target.md'], ['backlinks', 'Target.md', '--limit', '201'], ['backlinks', 'Target.md', '--cursor', 'bad'], ['backlinks', 'Target.md', '--tag', 'x']]) await cli(args, 2);
  await cli(['backlinks', 'absent.md'], 3); await cli(['backlinks', 'target.md'], 3);
  const other = join(cwd, 'other'); await mkdir(other); await initVault({ vault: other }); await writeFile(join(other, 'Target.md'), '');
  await assert.rejects(async () => operate(await selectVault({ vault: other }), 'backlinks', { path: 'Target.md', limit: 1, cursor: first }), (e) => e.code === 'VALIDATION_ERROR');
  const peer = protocol(t, vault);
  await peer.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'links', version: '1' } });
  peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 2;
  const call = async (args) => (await peer.request(id++, 'tools/call', { name: 'mdwiki_backlinks', arguments: args })).result;
  assert.deepEqual((await call({ path: 'Target.md' })).structuredContent, expected);
  for (const args of [{ path: 42 }, { path: 'Target.md', limit: '1' }, { path: 'Target.md', cursor: 42 }, { path: 'Target.md', vault }, { path: '../Target.md' }]) {
    const result = await call(args); assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, 'VALIDATION_ERROR');
  }
  await put('Target.md', '---\naliases: changed\n---\n');
  await cli(['backlinks', 'Target.md', '--limit', '1', '--cursor', first], 2);
  assert.deepEqual((await call({ path: 'Target.md' })).structuredContent, await cli(['backlinks', 'Target.md']));
  const db = new DatabaseSync(dbPath); db.exec('PRAGMA user_version=2'); db.close();
  const broken = await cli(['backlinks', 'Target.md'], 5); assert.match(broken.error.message, /reindex --full/); assert.ok(broken.error.message.includes(dbPath));
  await cli(['reindex', '--full']);
  assert.deepEqual((await call({ path: 'Target.md' })).structuredContent, await cli(['backlinks', 'Target.md']));
  assert.equal(selected.indexDir, join(cwd, 'cache'));
  peer.child.stdin.end(); assert.equal((await peer.closed).code, 0); peer.assertClean();
});

test('physical Unicode spelling and bounded pages/candidate context survive real interfaces', async (t) => {
  const { cwd, vault, put, backlinks } = await fixture(t);
  await put('É.md', '');
  await put('Source.md', '[[É]] [[é]] [[E\u0301]] [[.hidden]] [[' + 'x'.repeat(5000) + ']]');
  const result = await run(t, ['--vault', vault, 'backlinks', 'É.md', '--json'], cwd);
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.data.entries.length, 1);
  assert.deepEqual(body.data.link_diagnostics.map((d) => d.code), ['MISSING_LINK', 'MISSING_LINK', 'INVALID_LINK', 'INVALID_LINK']);
  assert.ok(body.data.link_diagnostics.every((d) => d.occurrence.context.length <= 320));
  for (let i = 0; i < 205; i++) await put(`d${String(i).padStart(3, '0')}/Duplicate.md`, '---\naliases: repeated\n---\n');
  await put('Source.md', '[[Duplicate]] [[repeated]] ' + '[[É]] '.repeat(205));
  const first = await backlinks('É.md');
  assert.equal(first.data.entries.length + first.data.link_diagnostics.length, 50);
  for (const diagnostic of first.data.link_diagnostics) {
    assert.equal(diagnostic.candidates.length, 200); assert.equal(diagnostic.candidate_count, 205);
  }
  const max = await backlinks('É.md', { limit: 200 });
  assert.equal(max.data.entries.length + max.data.link_diagnostics.length, 200);
  const last = await backlinks('É.md', { limit: 200, cursor: max.data.next_cursor });
  assert.equal(last.data.entries.length, 7); assert.equal(last.data.next_cursor, null);
});

test('unreadable target and source remove stale graph results and recover on reconciliation', async (t) => {
  const fs = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { vault, put, backlinks } = await fixture(t);
  await put('Source.md', '[[Target]]'); await put('Target.md', '');
  assert.equal((await backlinks('Target.md')).data.entries.length, 1);
  const original = fs.open;
  let blocked = 'Target.md';
  const mock = t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(vault, blocked)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    let result = await backlinks('Target.md');
    assert.equal(result.data.entries.length, 0);
    assert.equal(result.data.link_diagnostics[0].code, 'MISSING_LINK');
    assert.equal(result.diagnostics[0].code, 'UNREADABLE_NOTE');
    blocked = 'Source.md';
    result = await backlinks('Target.md');
    assert.equal(result.data.entries.length, 0); assert.equal(result.data.link_diagnostics.length, 0);
    assert.equal(result.diagnostics[0].path, 'Source.md');
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal((await backlinks('Target.md')).data.entries.length, 1);
});
