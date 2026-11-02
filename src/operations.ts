import { indexed } from './index/cache.js';
import { z } from 'zod';
import { AppError, errorResult, success } from './output.js';
import { listNotes, readNote, treeNotes } from './core/notes.js';
import { mutate } from './core/mutations.js';
import { NOTE_LIMIT } from './core/paths.js';
import type { Vault } from './core/vault.js';

const mutation = { path: z.string().min(1).max(4096), content: z.string().max(NOTE_LIMIT), dry_run: z.boolean().optional() };
export const schemas = {
  write: z.strictObject({ ...mutation, expected_version: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  append: z.strictObject(mutation),
  backlinks: z.strictObject({ path: z.string().min(1).max(4096), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() }),
  reindex: z.strictObject({ full: z.boolean().optional() }),
  search: z.strictObject({ query: z.string().min(1).max(4096), tags: z.array(z.string().min(1).max(256)).max(50).optional(), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() }),
  list: z.strictObject({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() }),
  tree: z.strictObject({ depth: z.number().int().min(1).max(50).optional(), limit: z.number().int().min(1).max(200).optional() }),
  read: z.strictObject({ path: z.string().min(1).max(4096) }),
};
export type Operation = keyof typeof schemas;
export async function operate(vault: Vault, operation: Operation, input: unknown, runIndex: typeof indexed = indexed) {
  const parsed = schemas[operation].safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid operation arguments: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  switch (operation) {
    case 'write':
    case 'append': {
      const result = await mutate(vault, schemas[operation].parse(input), operation === 'append');
      if (result.dry_run) return success(result);
      const warnings = result.publication_warning ? [{ code: 'PUBLICATION_CLEANUP_FAILED', message: result.publication_warning, path: result.path }] : [];
      try {
        const index = await runIndex(vault);
        return success({ ...result, index: { ok: true, data: index.data } }, [...warnings, ...index.diagnostics]);
      } catch (error) {
        const failure = errorResult(error).error;
        return success({ ...result, index: { ok: false, error: failure } },
          [...warnings, { code: 'INDEX_UPDATE_FAILED', message: `File write succeeded; do not retry append. ${failure.message}`, path: result.path }]);
      }
    }
    case 'backlinks': return runIndex(vault, { backlinks: schemas.backlinks.parse(input) });
    case 'reindex': return runIndex(vault, schemas.reindex.parse(input));
    case 'search': return runIndex(vault, { search: schemas.search.parse(input) });
    case 'list': return listNotes(vault, schemas.list.parse(input));
    case 'tree': return treeNotes(vault, schemas.tree.parse(input));
    case 'read': return readNote(vault, schemas.read.parse(input).path);
  }
}
export async function toolResult(vault: Vault, operation: Operation, input: unknown, runIndex: typeof indexed = indexed) {
  try { return await operate(vault, operation, input, runIndex); }
  catch (error) { return errorResult(error); }
}
