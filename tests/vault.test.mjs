import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
const core = process.env.MDWIKI_TEST_CORE ?? new URL('../dist/', import.meta.url).pathname;
const { initVault, selectVault } = await import(pathToFileURL(join(core, 'core/vault.js')));
const { listNotes, treeNotes, readNote } = await import(pathToFileURL(join(core, 'core/notes.js')));
async function fixture(t) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'mdwiki-vault-')));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const vault = join(scratch, 'vault');
  await mkdir(vault);
  return { scratch, vault };
}
const rejects = (fn, code) => assert.rejects(fn, (e) => e.code === code);

test('init preserves notes, discovers nearest marker, persists canonical external cache and refuses conflicts', async (t) => {
  const { scratch, vault } = await fixture(t);
  const bytes = Buffer.from('\uFEFF# Original\r\n');
  await writeFile(join(vault, 'note.md'), bytes);
  const initial = await initVault({ vault, indexDir: 'cache', cwd: scratch });
  assert.equal(initial.data.index_dir, join(scratch, 'cache'));
  assert.deepEqual(await initVault({ vault }), initial);
  const overridden = await selectVault({ vault, indexDir: 'session-cache', cwd: scratch });
  assert.equal(overridden.indexDir, join(scratch, 'session-cache'));
  assert.equal((await selectVault({ vault })).indexDir, initial.data.index_dir);
  assert.equal(await readFile(join(vault, '.mdwiki/.gitignore'), 'utf8'), '*\n');
  assert.deepEqual(await readFile(join(vault, 'note.md')), bytes);
  await rejects(() => initVault({ vault, indexDir: join(scratch, 'other') }), 'CONFLICT');
  await rejects(() => initVault({ vault, indexDir: vault }), 'VALIDATION_ERROR');
  await mkdir(join(vault, 'nested/deeper'), { recursive: true });
  assert.equal((await selectVault({ cwd: join(vault, 'nested/deeper') })).root, vault);
  await initVault({ vault: join(vault, 'nested') });
  assert.equal((await selectVault({ cwd: join(vault, 'nested/deeper') })).root, join(vault, 'nested'));
  assert.equal((await selectVault({ vault, cwd: join(vault, 'nested') })).root, vault);
  await rejects(() => initVault({ vault: join(vault, 'nested'), indexDir: join(scratch, 'cache') }), 'CONFLICT');
  const other = join(scratch, 'other');
  await mkdir(other);
  await rejects(() => initVault({ vault: other, indexDir: join(scratch, 'cache') }), 'CONFLICT');
  await rejects(() => selectVault({ cwd: scratch }), 'NOT_FOUND');
  await rejects(() => initVault({ vault: join(scratch, 'missing') }), 'NOT_FOUND');
});

test('symlinked metadata, binding files and cache directories are refused without touching targets', async (t) => {
  for (const target of ['.mdwiki', '.mdwiki/config.json', '.mdwiki/.gitignore', 'cache', 'cache/vault.json']) {
    const { scratch, vault } = await fixture(t);
    const outside = join(scratch, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'sentinel'), 'safe');
    const path = join(vault, target);
    await mkdir(join(path, '..'), { recursive: true });
    await symlink(outside, path);
    await rejects(() => initVault({ vault, ...(target.startsWith('cache') ? { indexDir: join(vault, 'cache') } : {}) }), 'UNSAFE_PATH');
    assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'safe');
  }
});

test('listing and exact reads share policy including physical case/Unicode spelling and ancestor symlinks', async (t) => {
  const { scratch, vault } = await fixture(t);
  await mkdir(join(vault, 'folder'));
  const names = ['A.md', 'a.MD', 'folder/hello world.md', 'é.md', 'e\u0301.md'];
  // On insensitive filesystems retain only actual physical names, never guess aliases.
  for (const name of names) await writeFile(join(vault, name), '# ' + name);
  await mkdir(join(vault, '.hidden'));
  await writeFile(join(vault, '.hidden/note.md'), 'hidden');
  await writeFile(join(vault, '.secret.md'), 'hidden');
  await writeFile(join(vault, 'image.png'), 'attachment');
  await writeFile(join(vault, 'bad\\name.md'), 'invalid path');
  await symlink(join(vault, 'A.md'), join(vault, 'alias.md'));
  await symlink(join(vault, 'folder'), join(vault, 'linked'));
  await link(join(vault, 'A.md'), join(vault, 'hard.md'));
  const cache = join(vault, 'cache');
  await initVault({ vault, indexDir: cache });
  await writeFile(join(cache, 'excluded.md'), 'cache');
  const selected = await selectVault({ vault });
  const entries = (await listNotes(selected)).data.entries;
  assert.ok(entries.length >= 4);
  for (const { path } of entries) assert.equal((await readNote(selected, path)).data.path, path);
  assert.ok(entries.some(({ path }) => path === 'a.MD' || path === 'A.md'));
  for (const path of ['../A.md', '/A.md', 'folder//x.md', './A.md', 'folder/../A.md', 'folder/./a.md',
    '.secret.md', '.hidden/note.md', 'A', 'image.png', 'C:/A.md', 'bad\\name.md', '', 'folder/']) {
    await rejects(() => readNote(selected, path), 'VALIDATION_ERROR');
  }
  for (const path of ['alias.md', 'linked/hello world.md', 'cache/excluded.md']) await rejects(() => readNote(selected, path), 'UNSAFE_PATH');
  await rejects(() => readNote(selected, 'missing.md'), 'NOT_FOUND');
  await symlink(vault, join(scratch, 'root-alias'));
  assert.equal((await selectVault({ vault: join(scratch, 'root-alias') })).root, vault);
});

test('list and tree refuse directories replaced after directory entries are captured', async (t) => {
  // Controlled readdir boundaries reproduce replacement without timing or real data.
  for (const operation of [listNotes, treeNotes]) {
    for (const transition of ['before-descent', 'after-read', 'ancestor']) {
      const { scratch, vault } = await fixture(t);
      const branch = join(vault, 'branch');
      const cache = join(vault, 'cache');
      await mkdir(join(branch, 'child'), { recursive: true });
      await initVault({ vault, indexDir: cache });
      const outside = join(scratch, 'outside');
      await mkdir(join(outside, 'excluded-empty'), { recursive: true });
      await mkdir(join(cache, 'excluded-empty'));
      const selected = await selectVault({ vault });
      const original = fs.readdir;
      const boundary = transition === 'before-descent' ? vault
        : transition === 'after-read' ? branch : join(branch, 'child');
      let replaced = false;
      const mock = t.mock.method(fs, 'readdir', async (...args) => {
        const entries = await original(...args);
        if (!replaced && args[0] === boundary) {
          replaced = true;
          await fs.rename(branch, join(scratch, 'saved-branch'));
          await symlink(transition === 'after-read' ? cache : outside, branch);
        }
        return entries;
      });
      syncBuiltinESMExports();
      try {
        await rejects(() => operation(selected), 'UNSAFE_PATH');
        assert.equal(replaced, true);
      } finally {
        mock.mock.restore();
        syncBuiltinESMExports();
      }
    }
  }
});

test('raw reads preserve BOM/CRLF and hash bytes; UTF-8, size and YAML failures are explicit', async (t) => {
  const { vault } = await fixture(t);
  await initVault({ vault });
  const selected = await selectVault({ vault });
  const raw = '\uFEFF---\r\ntitle: Real title # comment\r\nbig: 9007199254740993\r\nflag: true\r\nnone: null\r\nquoted: "123"\r\ndate: 2026-11-02\r\nnested: {a: [1, false]}\r\n---\r\n# Body\r\n';
  await writeFile(join(vault, 'raw.md'), raw);
  const result = await readNote(selected, 'raw.md');
  assert.equal(result.data.content, raw);
  assert.equal(result.data.content_version, createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.data.title, 'Real title');
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.metadata)), { title: 'Real title', big: '9007199254740993', flag: true, none: null,
    quoted: '123', date: '2026-11-02', nested: { a: [1, false] } });
  assert.equal(result.degraded, false);
  for (const yaml of ['a: [', 'a: 1\na: 2', '1: foo', 'a: !custom foo', 'a: .nan', 'a: .inf', '- sequence',
    'a: &a [*a]', 'a: ' + '['.repeat(51) + '0' + ']'.repeat(51),
    'a: &a 1\nb: [' + Array(101).fill('*a').join(',') + ']']) {
    const content = `---\n${yaml}\n---\nbody`;
    await writeFile(join(vault, 'bad.md'), content);
    const bad = await readNote(selected, 'bad.md');
    assert.equal(bad.data.content, content);
    assert.equal(bad.degraded, true, yaml);
    assert.equal(bad.diagnostics[0].code, 'INVALID_FRONTMATTER');
  }
  for (const content of ['---\na: 1', '---\ntitle: 4\ntags: x\ncreated: yesterday\n---\nbody']) {
    await writeFile(join(vault, 'bad.md'), content);
    assert.equal((await readNote(selected, 'bad.md')).degraded, true);
  }
  await writeFile(join(vault, 'plain.md'), '# Plain\n');
  assert.equal((await readNote(selected, 'plain.md')).data.title, 'Plain');
  await writeFile(join(vault, 'invalid.md'), Buffer.from([0xc3, 0x28]));
  await rejects(() => readNote(selected, 'invalid.md'), 'INVALID_UTF8');
  await writeFile(join(vault, 'large.md'), Buffer.alloc(10 * 1024 * 1024, 120));
  assert.equal((await readNote(selected, 'large.md')).data.content.length, 10 * 1024 * 1024);
  await writeFile(join(vault, 'large.md'), Buffer.alloc(10 * 1024 * 1024 + 1));
  await rejects(() => readNote(selected, 'large.md'), 'SIZE_LIMIT');
});

test('pagination is bounded, sorted, vault/generation/query bound; tree reports depth and entry truncation', async (t) => {
  const { vault, scratch } = await fixture(t);
  await initVault({ vault });
  await mkdir(join(vault, 'a/b'), { recursive: true });
  for (const path of ['z.md', 'a/x.md', 'a/b/y.md']) await writeFile(join(vault, path), '# ' + path);
  const selected = await selectVault({ vault });
  const first = await listNotes(selected, { limit: 1 });
  assert.equal(first.data.entries[0].path, 'a/b/y.md');
  const second = await listNotes(selected, { limit: 1, cursor: first.data.next_cursor });
  assert.equal(second.data.entries[0].path, 'a/x.md');
  for (const cursor of [42, '', 'abc', '!!!!', Buffer.from('{}').toString('base64url')]) await rejects(() => listNotes(selected, { cursor }), 'VALIDATION_ERROR');
  await rejects(() => listNotes(selected, { limit: 2, cursor: first.data.next_cursor }), 'VALIDATION_ERROR');
  const other = join(scratch, 'other');
  await mkdir(other);
  await initVault({ vault: other });
  await rejects(async () => listNotes(await selectVault({ vault: other }), { limit: 1, cursor: first.data.next_cursor }), 'VALIDATION_ERROR');
  await writeFile(join(vault, 'z.md'), 'changed');
  await rejects(() => listNotes(selected, { limit: 1, cursor: first.data.next_cursor }), 'VALIDATION_ERROR');
  for (const limit of [0, -1, 201, 1.2, '1', NaN, Infinity]) await rejects(() => listNotes(selected, { limit }), 'VALIDATION_ERROR');
  for (const depth of [0, 51, 1.2, '1']) await rejects(() => treeNotes(selected, { depth }), 'VALIDATION_ERROR');
  assert.equal((await treeNotes(selected, { depth: 1 })).data.truncated, true);
  assert.equal((await treeNotes(selected, { limit: 1 })).data.entries.length, 1);
  assert.equal((await treeNotes(selected, { depth: 5 })).degraded, false);
});

test('default and maximum pages and default tree stay bounded with more than 200 notes', async (t) => {
  const { vault } = await fixture(t);
  await initVault({ vault });
  for (let i = 0; i < 205; i++) await writeFile(join(vault, `${String(i).padStart(3, '0')}.md`), '# Small\n');
  const selected = await selectVault({ vault });
  assert.equal((await listNotes(selected)).data.entries.length, 50);
  const first = await listNotes(selected, { limit: 200 });
  assert.equal(first.data.entries.length, 200);
  const last = await listNotes(selected, { limit: 200, cursor: first.data.next_cursor });
  assert.equal(last.data.entries.length, 5);
  assert.equal(last.data.next_cursor, null);
  assert.equal(new Set([...first.data.entries, ...last.data.entries].map(({ path }) => path)).size, 205);
  const tree = await treeNotes(selected);
  assert.equal(tree.data.entries.length, 200);
  assert.equal(tree.data.truncated, true);
  assert.equal(tree.degraded, true);
});

test('read title uses valid metadata, then the first body heading outside code, then filename', async (t) => {
  const { vault } = await fixture(t);
  await initVault({ vault });
  const selected = await selectVault({ vault });
  const cases = [
    ['#\nbody', 'title'],
    ['```md\n# Code\n```\n## Real title ##\n', 'Real title'],
    ['---\ncustom: |\n  # YAML heading\n---\n# Body heading\n', 'Body heading'],
    ['Setext heading\n===\n', 'Setext heading'],
    ['# Hello#\n', 'Hello#'],
    ['<!--\n# Hidden comment\n-->\n# Visible title\n', 'Visible title'],
    ['<!-- unclosed\n# Hidden\n', 'title'],
    ['```\n<!--\n```\n# Visible\n', 'Visible'],
  ];
  for (const [content, title] of cases) {
    await writeFile(join(vault, 'title.md'), content);
    assert.equal((await readNote(selected, 'title.md')).data.title, title);
  }
});

test('managed YAML types are checked before unsafe integer JSON conversion, including aliases', async (t) => {
  const { vault } = await fixture(t);
  await initVault({ vault });
  const selected = await selectVault({ vault });
  for (const value of ['42', '9007199254740993', '*number']) {
    await writeFile(join(vault, 'types.md'), `---\ncustom: &number 9007199254740993\ntitle: ${value}\ntags: [${value}]\n---\n# Actual title\n`);
    const result = await readNote(selected, 'types.md');
    assert.equal(result.degraded, true);
    assert.deepEqual(result.diagnostics.map((d) => d.message), ['Invalid managed field: title.', 'Invalid managed field: tags.']);
    assert.equal(result.data.title, 'Actual title');
    assert.equal(result.data.metadata.custom, '9007199254740993');
  }
  await writeFile(join(vault, 'types.md'), '---\ntitle: &text "9007199254740993"\ntags: [*text]\n---\n# Body\n');
  const quoted = await readNote(selected, 'types.md');
  assert.equal(quoted.degraded, false);
  assert.equal(quoted.data.title, '9007199254740993');
});
