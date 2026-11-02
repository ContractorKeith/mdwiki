import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const { openCache, schemaVersion } = await import(process.env.MDWIKI_TEST_SCHEMA
  ? pathToFileURL(process.env.MDWIKI_TEST_SCHEMA).href
  : '../dist/index/schema.js');

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mdwiki-schema-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'cache.sqlite');
}

test('FTS5 matches tokens, persists data and reopens the versioned schema', async (t) => {
  const path = await scratch(t);
  let db = openCache(path);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, schemaVersion);
    db.prepare('INSERT INTO capability_fts(text) VALUES (?)').run('disposable harness');
    assert.equal(db.prepare('SELECT text FROM capability_fts WHERE capability_fts MATCH ?')
      .get('harness').text, 'disposable harness');
    assert.equal(db.prepare('SELECT text FROM capability_fts WHERE capability_fts MATCH ?')
      .get('absent'), undefined);
  } finally { db.close(); }
  db = openCache(path);
  try {
    assert.equal(db.prepare('SELECT count(*) AS count FROM capability_fts').get().count, 1);
  } finally { db.close(); }
});

test('incompatible cache is refused without changing its version or data', async (t) => {
  const path = await scratch(t);
  let db = new DatabaseSync(path);
  db.exec('PRAGMA user_version = 999; CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES (42)');
  db.close();
  assert.throws(() => openCache(path), /INCOMPATIBLE_SCHEMA/);
  db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 999);
    assert.equal(db.prepare('SELECT value FROM sentinel').get().value, 42);
  } finally { db.close(); }
});
