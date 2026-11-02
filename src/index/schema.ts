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
