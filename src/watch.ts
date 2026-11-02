import type { FSWatcher } from 'node:fs';
import { attach } from './core/watch.js';
import type { Vault } from './core/vault.js';
import { DataCacheError, indexed, type IndexInput, type SyncReport } from './index/cache.js';
import { AppError, errorResult, type Diagnostic } from './output.js';

export interface WatchEvent {
  schema_version: 1; event: 'ready' | 'sync' | 'diagnostic' | 'stopped' | 'error';
  sequence: number; timestamp: string; data: Record<string, unknown>;
  diagnostics: Diagnostic[]; degraded: boolean;
}
interface Options {
  emit?: (event: WatchEvent) => void;
  // Small deterministic fixtures can control notification and reconciliation clocks.
  attach?: typeof attach; interval?: number; debounce?: number;
}

// One lifecycle per process-selected vault. Index and mutation coordination remain
// independent; this queue never holds a mutation lock while awaiting index work.
export class WatchSession {
  private watcher: FSWatcher | undefined;
  private periodic: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private sequence = 0;
  private active = false;
  private ready = false;
  private stopped = false;
  private fatal: AppError | undefined;
  private failures = 0;
  private background = false;
  private watcherFailure: Error | undefined;
  private lastDiagnostics = '';

  constructor(private vault: Vault, private options: Options = {}) {}

  private emit(event: WatchEvent['event'], data: Record<string, unknown>, diagnostics: Diagnostic[] = [], degraded = diagnostics.length > 0) {
    this.options.emit?.({ schema_version: 1, event, sequence: ++this.sequence,
      timestamp: new Date().toISOString(), data, diagnostics, degraded });
  }
  private resources() {
    this.watcher?.close(); this.watcher = undefined;
    clearInterval(this.periodic); clearTimeout(this.debounce);
    this.periodic = undefined; this.debounce = undefined;
  }
  private schedule(delay = this.options.debounce ?? 75) {
    if (this.stopped || this.fatal || this.debounce || this.background) return;
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      this.background = true;
      // run reports failures; keep at most one background pass queued.
      void this.reconcile({}, true).catch(() => {}).finally(() => {
        this.background = false;
        if (this.failures && !this.fatal) this.schedule(250 * 2 ** (this.failures - 1));
      });
    }, delay);
  }
  private dirty = () => { this.revision++; this.schedule(); };
  private attachFailed = (error: Error) => {
    this.watcherFailure = error;
    this.watcher?.close(); this.watcher = undefined;
    this.revision++;
    this.schedule();
  };
  private async activate() {
    if (!this.active) {
      this.active = true;
      this.periodic = setInterval(() => this.schedule(0), this.options.interval ?? 5000);
    }
    if (this.watcherFailure) {
      this.emit('diagnostic', { code: 'WATCH_UNAVAILABLE', message: 'Filesystem notifications failed; reattaching and reconciling.', retry: true },
        [{ code: 'WATCH_UNAVAILABLE', message: 'Filesystem notifications failed; reattaching and reconciling.' }]);
      this.watcherFailure = undefined;
    }
    if (!this.watcher) {
      try { this.watcher = await (this.options.attach ?? attach)(this.vault, this.dirty, this.attachFailed); }
      catch { throw new AppError('WATCH_UNAVAILABLE', 'Cannot attach filesystem notifications; check vault access and OS watcher limits, then restart if retries fail.', 5); }
    }
  }
  private committed = (report: SyncReport) => {
    if (this.stopped) return;
    const { updated, diagnostics, generation, added, changed, removed } = report;
    if (this.ready && updated) this.emit('sync', { generation, added, changed, removed }, diagnostics);
    const signature = JSON.stringify(diagnostics);
    if (diagnostics.length && signature !== this.lastDiagnostics) {
      this.emit('diagnostic', { code: 'INDEX_DEGRADED', message: 'Some notes have diagnostics; unreadable notes are excluded. Reconciliation will retry.', retry: true }, diagnostics);
    }
    this.lastDiagnostics = signature;
  };
  run(input: IndexInput = {}): ReturnType<typeof indexed> { return this.reconcile(input, false); }

  private reconcile(input: IndexInput, recover: boolean): ReturnType<typeof indexed> {
    // A published write can enqueue index work before its OS notification arrives.
    this.revision++;
    const next = this.tail.catch(() => {}).then(async () => {
      if (this.stopped) throw new AppError('OPERATIONAL_ERROR', 'Watcher has stopped.', 5);
      if (this.fatal) throw this.fatal;
      try {
        await this.activate(); // Attach before scanning, then repeat if notified during scan.
        if (this.stopped) throw new AppError('OPERATIONAL_ERROR', 'Watcher has stopped.', 5);
        let result: Awaited<ReturnType<typeof indexed>>;
        let observed: number;
        do {
          observed = this.revision;
          try { result = await indexed(this.vault, input, this.committed); }
          catch (error) {
            if (!(error instanceof DataCacheError) || input.full || !recover) throw error;
            this.emit('diagnostic', { code: 'CACHE_REBUILD', message: error.message, retry: true }, [{ code: 'CACHE_REBUILD', message: error.message }]);
            await indexed(this.vault, { full: true }, this.committed);
            result = await indexed(this.vault, input, this.committed);
          }
        } while (!this.stopped && observed !== this.revision);
        if (this.watcherFailure || !this.watcher) throw new AppError('OPERATIONAL_ERROR', 'Filesystem notifications failed during reconciliation; retrying attachment.', 5);
        this.failures = 0;
        if (!this.ready && !this.stopped) {
          this.ready = true;
          this.emit('ready', { vault: this.vault.root, generation: result.data.generation }, result.diagnostics);
        }
        return result;
      } catch (error) {
        if (this.stopped) throw error;
        // Invalid queries/cursors are caller errors, not lifecycle failures.
        if (error instanceof AppError && (error.code === 'VALIDATION_ERROR' || (error.code === 'NOT_FOUND' && input.backlinks))) throw error;
        const failure = errorResult(error).error;
        this.failures++;
        if (this.failures >= 3) {
          this.fatal = new AppError(failure.code, `${failure.message} Watching stopped after three consecutive failures; repair the cause and restart this process.`, 5);
          this.resources();
          this.emit('error', { code: this.fatal.code, message: this.fatal.message }, [], true);
        } else {
          this.emit('diagnostic', { ...failure, retry: true, attempt: this.failures, retry_ms: 250 * 2 ** (this.failures - 1) }, [failure]);
          this.schedule(250 * 2 ** (this.failures - 1));
        }
        throw error;
      }
    });
    this.tail = next;
    return next;
  }
  async close(reason = 'shutdown', emit = true) {
    if (this.stopped) return;
    this.stopped = true;
    this.resources();
    await this.tail.catch(() => {});
    this.resources(); // Attachment may have completed after shutdown began.
    if (emit && !this.fatal) this.emit('stopped', { reason });
  }
}
