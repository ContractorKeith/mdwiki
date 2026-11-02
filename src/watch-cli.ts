import type { Vault } from './core/vault.js';
import { WatchSession } from './watch.js';

export async function watchCli(vault: Vault, json: boolean) {
  let output = true;
  let finishing: Promise<void> | undefined;
  const session = new WatchSession(vault, { emit: (event) => {
    if (!output) return;
    if (json) process.stdout.write(JSON.stringify(event) + '\n');
    else {
      process.stdout.write(`${event.event}: ${JSON.stringify(event.data)}\n`);
      for (const diagnostic of event.diagnostics) process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n`);
    }
    if (event.event === 'error') { process.exitCode = 5; void stop('fatal error'); }
  } });
  function stop(reason: string, closedOutput = false) {
    if (closedOutput) output = false;
    finishing ??= session.close(reason, output).then(() => {
      process.stdin.pause();
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      process.stdin.off('end', eof); process.stdin.off('close', eof);
    });
    return finishing;
  }
  const interrupt = () => { void stop('SIGINT'); };
  const terminate = () => { void stop('SIGTERM'); };
  const eof = () => { void stop('stdin EOF'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  process.stdin.once('end', eof); process.stdin.once('close', eof);
  process.stdout.once('close', () => { void stop('stdout closed', true); });
  process.stdout.on('error', () => { void stop('stdout closed', true); });
  process.stdin.resume();
  // Recoverable startup failures are retried by the lifecycle, with diagnostics.
  await session.run().catch(() => {});
}
