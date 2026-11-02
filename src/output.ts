export interface Failure { code: string; message: string }
export interface Diagnostic { code: string; message: string; path?: string }
export class AppError extends Error {
  constructor(public code: string, message: string, public exit = 2) { super(message); }
}
export function success<T>(data: T, diagnostics: Diagnostic[] = [], incomplete = false) {
  return { schema_version: 1 as const, ok: true as const, data,
    diagnostics, degraded: incomplete || diagnostics.length > 0 };
}
export function failure(error: Failure) {
  return { schema_version: 1 as const, ok: false as const, error,
    diagnostics: [], degraded: false };
}
export function errorResult(error: unknown) {
  return failure(error instanceof AppError ? { code: error.code, message: error.message }
    : { code: 'OPERATIONAL_ERROR', message: 'Could not complete vault operation.' });
}
