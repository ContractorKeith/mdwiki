export interface Failure {
  code: string;
  message: string;
}

export function success<T>(data: T) {
  return { schema_version: 1 as const, ok: true as const, data,
    diagnostics: [], degraded: false };
}

export function failure(error: Failure) {
  return { schema_version: 1 as const, ok: false as const, error,
    diagnostics: [], degraded: false };
}
