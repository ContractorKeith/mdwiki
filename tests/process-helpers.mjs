import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const cli = process.env.MDWIKI_TEST_BIN ?? fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// Every subprocess is bounded, reaped, and started outside any user vault.
export function start(t, args, cwd) {
  const child = spawn(process.env.MDWIKI_TEST_BIN ? cli : process.execPath,
    process.env.MDWIKI_TEST_BIN ? args : [cli, ...args], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
  child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
  child.stdin.on('error', () => {});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 8000);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`Child timed out: ${args.join(' ')}; stderr: ${stderr}`));
      else resolve({ code, signal, stdout, stderr });
    });
  });
  // Attach immediately so a timeout cannot become an unhandled rejection.
  void closed.catch(() => {});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed.catch(() => {});
  });
  return { child, closed };
}

export async function run(t, args, cwd) {
  const { child, closed } = start(t, args, cwd);
  child.stdin.end();
  return closed;
}

export function protocol(t, cwd) {
  const process = start(t, ['mcp'], cwd);
  const messages = [];
  const pending = new Map();
  let buffer = '';
  let parseError;
  process.child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      try {
        const message = JSON.parse(line);
        messages.push(message);
        pending.get(message.id)?.resolve(message);
        pending.delete(message.id);
      } catch (error) { parseError = error; }
    }
  });
  void process.closed.then(() => {
    for (const waiter of pending.values()) waiter.reject(new Error('MCP exited before response'));
    pending.clear();
  }, (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const send = (message) => process.child.stdin.write(JSON.stringify(message) + '\n');
  const request = (id, method, params) => {
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return response;
  };
  return { ...process, send, request, messages,
    assertClean() { assert.ifError(parseError); assert.equal(buffer, ''); } };
}
