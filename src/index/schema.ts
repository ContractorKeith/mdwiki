import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const schemaVersion = 2;
const definitions = {
  state: 'CREATE TABLE state (vault TEXT NOT NULL, generation TEXT NOT NULL)',
  notes: 'CREATE TABLE notes (path TEXT PRIMARY KEY, version TEXT NOT NULL, title TEXT NOT NULL, metadata TEXT NOT NULL, diagnostics TEXT NOT NULL)',
  tags: 'CREATE TABLE tags (path TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(path, tag))',
  failures: 'CREATE TABLE failures (path TEXT PRIMARY KEY, code TEXT NOT NULL, message TEXT NOT NULL)',
  documents: 'CREATE VIRTUAL TABLE documents USING fts5(title, path, body, metadata)',
};
const normalized = (sql: string) => sql.replace(/\s+/g, '').toLowerCase();
// Only called while holding the persistent coordinator transaction.
export function openCache(filename: string, vault: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL');
    const version = db.prepare('PRAGMA user_version').get()!.user_version;
    const objects = db.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    if (version === 0 && objects.length === 0) {
      db.exec('BEGIN IMMEDIATE');
      for (const sql of Object.values(definitions)) db.exec(sql);
      db.prepare('INSERT INTO state VALUES (?, ?)').run(vault, randomUUID());
      db.exec(`PRAGMA user_version=${schemaVersion}; COMMIT`);
    } else if (version !== schemaVersion) throw new Error('Incompatible schema.');
    for (const [name, sql] of Object.entries(definitions)) {
      const actual = db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)?.sql;
      if (typeof actual !== 'string' || normalized(actual) !== normalized(sql)) throw new Error('Incompatible schema.');
    }
    if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('Corrupt cache.');
    const state = db.prepare('SELECT vault FROM state').all();
    if (state.length !== 1 || state[0]!.vault !== vault) throw new Error('Cache belongs to another vault.');
    // Check FTS shadow data as well as ordinary SQLite pages.
    db.exec("INSERT INTO documents(documents) VALUES ('integrity-check')");
    return db;
  } catch (error) { db.close(); throw error; }
}
