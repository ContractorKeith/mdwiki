// Node-only initialized stdio client. Usage: node mcp-workflow.mjs /absolute/bin/mdwiki
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const binary = process.argv[2];
assert.ok(binary, 'Pass the installed executable path');
const vault = await mkdtemp(join(tmpdir(), 'mdwiki-mcp-example-'));
let child;
let closed;
let timer;
try {
  const init = spawnSync(binary, ['init', '--vault', vault, '--json'], { encoding: 'utf8', timeout: 8000 });
  assert.ifError(init.error);
  assert.equal(init.status, 0, init.stderr ?? 'init failed');
  await writeFile(join(vault, 'target.md'), '# Target\n');
  await writeFile(join(vault, 'source.md'), '[[target]]\n');
  child = spawn(binary, ['--vault', vault, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    } catch (error) {
      for (const waiter of pending.values()) waiter.reject(error);
      child.kill('SIGKILL');
    }
  });
  closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      for (const waiter of pending.values()) waiter.reject(new Error('MCP closed before reply'));
      pending.clear();
      resolve(code);
    });
  });
  void closed.catch(() => {});
  timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  let id = 0;
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  const request = (method, params) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mdwiki-example', version: '1' } });
  assert.equal(initialized.error, undefined);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const tools = await request('tools/list', {});
  assert.equal(tools.result.tools.length, 8);
  const call = async (name, args, error = false) => {
    const reply = await request('tools/call', { name: 'mdwiki_' + name, arguments: args });
    assert.equal(reply.error, undefined, JSON.stringify(reply));
    assert.equal(reply.result.isError, error);
    const result = reply.result.structuredContent;
    assert.deepEqual(JSON.parse(reply.result.content[0].text), result);
    assert.equal(result.schema_version, 1);
    assert.equal(result.ok, !error);
    console.log(JSON.stringify({ tool: name, result }));
    return result;
  };
  assert.equal((await call('list', { limit: 1 })).data.entries.length, 1);
  await call('tree', { depth: 3, limit: 200 });
  const original = await call('read', { path: 'target.md' });
  const preview = await call('write', { path: 'new.md', content: '# Created\n', dry_run: true });
  assert.equal(preview.data.file_written, false);
  await call('write', { path: 'new.md', content: '# Created\n' });
  await call('write', { path: 'target.md', content: '# Target replaced\n', expected_version: original.data.content_version });
  assert.equal((await call('write', { path: 'target.md', content: 'stale', expected_version: original.data.content_version }, true)).error.code, 'CONFLICT');
  await call('append', { path: 'new.md', content: 'needle\n' });
  assert.equal((await call('search', { query: 'needle', tags: [], limit: 50 })).data.entries[0].path, 'new.md');
  assert.equal((await call('backlinks', { path: 'target.md' })).data.entries[0].path, 'source.md');
  await call('reindex', { full: true });
  assert.match((await call('read', { path: 'new.md' })).data.content, /needle/);
  child.stdin.end();
  assert.equal(await closed, 0);
  assert.equal(stderr, '');
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null) child.kill('SIGKILL');
  await closed?.catch(() => {});
  await rm(vault, { recursive: true, force: true });
}
