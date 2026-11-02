import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../output.js';

export interface SearchInput { query: string; tags?: string[] | undefined; limit?: number | undefined; cursor?: string | undefined }
export function compileQuery(query: string) {
  const clauses: string[] = [];
  let position = 0;
  while (position < query.length) {
    if (/\s/.test(query[position]!)) { position++; continue; }
    let text: string;
    const phrase = query[position] === '"';
    if (query[position] === '"') {
      const end = query.indexOf('"', position + 1);
      if (end < 0) throw new AppError('VALIDATION_ERROR', 'Unmatched double quote; close the search phrase.');
      text = query.slice(position + 1, end);
      position = end + 1;
    } else {
      const start = position;
      while (position < query.length && !/[\s"]/.test(query[position]!)) position++;
      text = query.slice(start, position);
    }
    // unicode61 tokenizes punctuation as separators. Quote every clause so user
    // operators, column names and SQL never become executable query syntax.
    if (!/[\p{L}\p{N}\p{Co}]/u.test(text)) {
      if (text.trim() && !phrase) continue;
      throw new AppError('VALIDATION_ERROR', 'Search phrases must contain searchable terms.');
    }
    if (phrase) clauses.push('"' + text.replaceAll('"', '""') + '"');
    else for (const token of text.match(/[\p{L}\p{N}\p{Co}\p{M}]+/gu) ?? []) clauses.push('"' + token + '"');
  }
  if (clauses.length > 128) throw new AppError('VALIDATION_ERROR', 'Use at most 128 search clauses.');
  if (!clauses.length) throw new AppError('VALIDATION_ERROR', 'Query must contain searchable words or double-quoted phrases.');
  return clauses.join(' AND ');
}
export function searchCache(db: DatabaseSync, vault: string, input: SearchInput) {
  const match = compileQuery(input.query);
  const limit = input.limit ?? 50;
  const tags = [...new Set(input.tags ?? [])].sort();
  const generation = db.prepare('SELECT generation FROM state').get()!.generation as string;
  const binding = createHash('sha256').update(JSON.stringify({ vault, generation, query: input.query, tags, limit })).digest('hex');
  let offset = 0;
  if (input.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as { binding: unknown; offset: unknown };
      if (cursor.binding !== binding || !Number.isSafeInteger(cursor.offset) || (cursor.offset as number) < 1) throw new Error();
      offset = cursor.offset as number;
    } catch { throw new AppError('VALIDATION_ERROR', 'Malformed, mismatched or stale search cursor; restart search.'); }
  }
  const rows = db.prepare(`SELECT documents.path, documents.title,
    bm25(documents, 8.0, 1.0, 1.0, 1.0) AS score,
    snippet(documents, -1, char(57344), char(57345), ' … ', 32) AS excerpt
    FROM documents WHERE documents MATCH ?
    ${tags.map(() => 'AND EXISTS (SELECT 1 FROM tags WHERE tags.path=documents.path AND tags.tag=? COLLATE BINARY)').join(' ')}
    ORDER BY score, documents.path COLLATE BINARY LIMIT ? OFFSET ?`).all(match, ...tags, limit + 1, offset);
  if (input.cursor && !rows.length) throw new AppError('VALIDATION_ERROR', 'Search cursor is beyond results; restart search.');
  return { entries: rows.slice(0, limit).map((row) => ({ path: row.path as string, title: row.title as string,
    score: row.score as number, excerpt: excerpt(row.excerpt as string) })), generation,
    next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ binding, offset: offset + limit })).toString('base64url') : null };
}

// A token may itself be very long; bound characters around the first match.
function excerpt(marked: string) {
  const match = marked.indexOf('\uE000');
  const text = marked.replaceAll('\uE000', '').replaceAll('\uE001', '');
  const start = Math.max(0, match - 80);
  return (start ? '… ' : '') + text.slice(start, start + 480) + (text.length > start + 480 ? ' …' : '');
}
