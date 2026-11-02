import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { protocol } from './process-helpers.mjs';
import { version } from '../dist/metadata.js';

async function session(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'mdwiki-mcp-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const peer = protocol(t, cwd);
  const initialized = await peer.request(1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'mdwiki-acceptance', version: '1.0.0' },
  });
  assert.equal(initialized.error, undefined);
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.deepEqual(initialized.result.serverInfo, { name: 'mdwiki', version });
  assert.equal(typeof initialized.result.capabilities.tools, 'object');
  peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { peer, cwd };
}

test('real MCP initializes, lists no tools, rejects unknown tools and handles concurrent requests', async (t) => {
  const { peer, cwd } = await session(t);
  const [list, ping] = await Promise.all([
    peer.request(2, 'tools/list', {}), peer.request(3, 'ping'),
  ]);
  assert.deepEqual(list.result, { tools: [] });
  assert.deepEqual(ping.result, {});
  const unknown = await peer.request(4, 'tools/call', { name: 'not_a_tool', arguments: {} });
  assert.ok(unknown.error || unknown.result?.isError);
  const invalid = await peer.request(5, 'tools/call', { name: 42 });
  assert.ok(invalid.error);
  const method = await peer.request(6, 'not/a/method');
  assert.equal(method.error.code, -32601);
  // EOF only after every expected reply; no sleeps or early stdin closure.
  peer.child.stdin.end();
  const result = await peer.closed;
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  peer.assertClean();
  assert.equal(peer.messages.length, 6);
  assert.deepEqual(await readdir(cwd), []);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`initialized MCP closes cleanly on ${signal}`, async (t) => {
    const { peer } = await session(t);
    peer.child.kill(signal);
    const result = await peer.closed;
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    peer.assertClean();
  });
}

test('malformed stdio input is diagnosed on stderr and a following request still works', async (t) => {
  const { peer } = await session(t);
  peer.child.stdin.write('{invalid json}\n{}\n');
  const ping = await peer.request(2, 'ping');
  assert.deepEqual(ping.result, {});
  peer.child.stdin.end();
  const result = await peer.closed;
  assert.equal(result.code, 0);
  assert.match(result.stderr, /^MCP_PROTOCOL_ERROR: Invalid stdio message\.\n$/);
  peer.assertClean();
});
