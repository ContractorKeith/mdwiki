import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Occurrence } from '../core/links.js';
import { AppError } from '../output.js';

export interface BacklinksInput { path: string; limit?: number | undefined; cursor?: string | undefined }
// One bounded page spans matching occurrences and vault-wide unresolved links.
export function backlinksCache(db: DatabaseSync, vault: string, input: BacklinksInput) {
  const limit = input.limit ?? 50;
  const generation = db.prepare('SELECT generation FROM state').get()!.generation as string;
  const binding = createHash('sha256').update(JSON.stringify({ vault, generation, target: input.path, limit })).digest('hex');
  let offset = 0;
  if (input.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as { binding: unknown; offset: unknown };
      if (cursor.binding !== binding || !Number.isSafeInteger(cursor.offset) || (cursor.offset as number) < 1) throw new Error();
      offset = cursor.offset as number;
    } catch { throw new AppError('VALIDATION_ERROR', 'Malformed, mismatched or stale backlinks cursor; restart backlinks.'); }
  }
  const rows = db.prepare('SELECT * FROM links WHERE resolved=? OR resolved IS NULL ORDER BY source COLLATE BINARY, ordinal LIMIT ? OFFSET ?').all(input.path, limit + 1, offset);
  if (input.cursor && !rows.length) throw new AppError('VALIDATION_ERROR', 'Backlinks cursor is beyond results; restart backlinks.');
  const entries: { path: string; occurrence: Occurrence }[] = [];
  const link_diagnostics: { path: string; occurrence: Occurrence; code: string; candidates: string[]; candidate_count: number }[] = [];
  for (const row of rows.slice(0, limit)) {
    const item = { path: row.source as string, occurrence: JSON.parse(row.occurrence as string) as Occurrence };
    if (row.resolved !== null) entries.push(item);
    else {
      const { code, candidates, candidate_count } = JSON.parse(row.diagnostic as string) as { code: string; candidates: string[]; candidate_count: number };
      link_diagnostics.push({ ...item, code, candidates, candidate_count });
    }
  }
  return { path: input.path, entries, link_diagnostics, generation,
    next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ binding, offset: offset + limit })).toString('base64url') : null };
}
