import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const { openCache, schemaVersion } = await import(process.env.MDWIKI_TEST_SCHEMA
  ? pathToFileURL(process.env.MDWIKI_TEST_SCHEMA).href : '../dist/index/schema.js');
async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mdwiki-schema-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'cache.sqlite');
}
test('vault-bound FTS schema persists, validates and refuses incompatible/masquerading tables', async (t) => {
  const path = await scratch(t);
  let db = openCache(path, '/fixture');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, schemaVersion);
  db.prepare('INSERT INTO documents(title,path,body,metadata) VALUES (?,?,?,?)').run('Title', 'a.md', 'disposable harness', '');
  db.close();
  db = openCache(path, '/fixture');
  assert.equal(db.prepare('SELECT path FROM documents WHERE documents MATCH ?').get('harness').path, 'a.md');
  db.close();
  assert.throws(() => openCache(path, '/other'), /another vault/);
  db = new DatabaseSync(path);
  db.exec('PRAGMA user_version=999');
  db.close();
  assert.throws(() => openCache(path, '/fixture'), /Incompatible schema/);
  db = new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 999);
  assert.equal(db.prepare('SELECT path FROM documents').get().path, 'a.md');
  db.exec(`PRAGMA user_version=${schemaVersion}; DROP TABLE documents; CREATE TABLE documents(title,path,body,metadata)`);
  db.close();
  assert.throws(() => openCache(path, '/fixture'), /Incompatible schema/);
});
