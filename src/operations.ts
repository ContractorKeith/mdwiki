import { indexed } from './index/cache.js';
import { z } from 'zod';
import { AppError, errorResult } from './output.js';
import { listNotes, readNote, treeNotes } from './core/notes.js';
import type { Vault } from './core/vault.js';

export const schemas = {
  backlinks: z.strictObject({ path: z.string().min(1).max(4096), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() }),
  reindex: z.strictObject({ full: z.boolean().optional() }),
  search: z.strictObject({ query: z.string().min(1).max(4096), tags: z.array(z.string().min(1).max(256)).max(50).optional(), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() }),
  list: z.strictObject({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() }),
  tree: z.strictObject({ depth: z.number().int().min(1).max(50).optional(), limit: z.number().int().min(1).max(200).optional() }),
  read: z.strictObject({ path: z.string().min(1).max(4096) }),
};
export type Operation = keyof typeof schemas;
export async function operate(vault: Vault, operation: Operation, input: unknown) {
  const parsed = schemas[operation].safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid operation arguments: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  switch (operation) {
    case 'backlinks': return indexed(vault, { backlinks: schemas.backlinks.parse(input) });
    case 'reindex': return indexed(vault, schemas.reindex.parse(input));
    case 'search': return indexed(vault, { search: schemas.search.parse(input) });
    case 'list': return listNotes(vault, schemas.list.parse(input));
    case 'tree': return treeNotes(vault, schemas.tree.parse(input));
    case 'read': return readNote(vault, schemas.read.parse(input).path);
  }
}
export async function toolResult(vault: Vault, operation: Operation, input: unknown) {
  try { return await operate(vault, operation, input); }
  catch (error) { return errorResult(error); }
}
