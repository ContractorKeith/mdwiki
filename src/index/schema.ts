import { DatabaseSync } from 'node:sqlite';

export const schemaVersion = 1;

// Private capability seam only. M1/M2 will define the vault-bound cache schema.
export function openCache(filename: string): DatabaseSync {
  const database = new DatabaseSync(filename);
  try {
    const row = database.prepare('PRAGMA user_version').get();
    if (row?.user_version !== 0 && row?.user_version !== schemaVersion) {
      throw new Error('INCOMPATIBLE_SCHEMA: rebuild this disposable cache.');
    }
    const existing = database.prepare(
      "SELECT sql FROM sqlite_schema WHERE name = 'capability_fts'",
    ).get();
    if (existing && (typeof existing.sql !== 'string'
      || !/\bCREATE\s+VIRTUAL\s+TABLE\b[\s\S]*\bUSING\s+fts5\s*\(/i.test(existing.sql))) {
      throw new Error('INCOMPATIBLE_SCHEMA: expected an FTS5 table; rebuild this disposable cache.');
    }
    database.exec(`
      BEGIN;
      CREATE VIRTUAL TABLE IF NOT EXISTS capability_fts USING fts5(text);
      PRAGMA user_version = ${schemaVersion};
      COMMIT;
    `);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
