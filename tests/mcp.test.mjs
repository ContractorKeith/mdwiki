import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, symlink, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { protocol, run } from './process-helpers.mjs';
import { version } from '../dist/metadata.js';

async function session(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'mdwiki-mcp-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  assert.equal((await run(t, ['init', '--vault', cwd], cwd)).code, 0);
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

test('real MCP initializes, lists exactly M1 tools, rejects unknown tools and handles concurrent requests', async (t) => {
  const { peer, cwd } = await session(t);
  const [list, ping] = await Promise.all([
    peer.request(2, 'tools/list', {}), peer.request(3, 'ping'),
  ]);
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['mdwiki_list', 'mdwiki_tree', 'mdwiki_read']);
  for (const tool of list.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.equal(list.result.tools[0].inputSchema.properties.limit.maximum, 200);
  assert.deepEqual(list.result.tools[2].inputSchema.required, ['path']);
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
  assert.deepEqual(await readdir(cwd), ['.mdwiki']);
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


test('M1 tools share envelopes, preserve content and validate invalid arguments without poisoning session', async (t) => {
  const { peer, cwd } = await session(t);
  await writeFile(join(cwd, 'hello world.MD'), '\uFEFF# Hello\r\n');
  await writeFile(join(cwd, 'other.md'), '---\na: [\n---\nraw');
  let id = 10;
  const call = async (name, args) => {
    const reply = await peer.request(id++, 'tools/call', { name: 'mdwiki_' + name, arguments: args });
    assert.equal(reply.error, undefined, JSON.stringify(reply));
    assert.deepEqual(JSON.parse(reply.result.content[0].text), reply.result.structuredContent);
    return reply.result;
  };
  const listed = await call('list', { limit: 1 });
  assert.equal(listed.structuredContent.data.entries[0].path, 'hello world.MD');
  const cliList = await run(t, ['list', '--limit', '1', '--json'], cwd);
  assert.deepEqual(JSON.parse(cliList.stdout), listed.structuredContent);
  const continued = await call('list', { limit: 1, cursor: listed.structuredContent.data.next_cursor });
  assert.equal(continued.structuredContent.data.entries[0].path, 'other.md');
  assert.equal(continued.structuredContent.data.next_cursor, null);
  const note = await call('read', { path: 'hello world.MD' });
  assert.equal(note.structuredContent.data.content, '\uFEFF# Hello\r\n');
  assert.equal(note.structuredContent.schema_version, 1);
  assert.equal(note.isError, false);
  const cliRead = await run(t, ['read', 'hello world.MD', '--json'], cwd);
  assert.equal(cliRead.code, 0);
  assert.deepEqual(JSON.parse(cliRead.stdout), note.structuredContent);
  const degraded = await call('read', { path: 'other.md' });
  assert.equal(degraded.structuredContent.degraded, true);
  assert.equal(degraded.isError, false);
  const tree = await call('tree', { limit: 1 });
  assert.equal(tree.structuredContent.data.truncated, true);
  const cliTree = await run(t, ['tree', '--limit', '1', '--json'], cwd);
  assert.equal(cliTree.code, 6);
  assert.deepEqual(JSON.parse(cliTree.stdout), tree.structuredContent);
  for (const [name, args] of [['list', { cursor: 42 }], ['list', { cursor: 'broken' }],
    ['list', { cursor: null }], ['list', { limit: '2' }], ['list', { limit: 201 }], ['tree', { depth: 0 }],
    ['read', {}], ['read', { path: 42 }], ['read', { path: '../escape.md' }],
    ['read', { path: 'other.md', vault: '/tmp' }]]) {
    const result = await call(name, args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'VALIDATION_ERROR');
  }
  await symlink(join(cwd, 'hello world.MD'), join(cwd, 'alias.md'));
  assert.equal((await call('read', { path: 'alias.md' })).structuredContent.error.code, 'UNSAFE_PATH');
  await writeFile(join(cwd, 'new.md'), 'new');
  assert.equal((await call('list', { limit: 1, cursor: listed.structuredContent.data.next_cursor })).structuredContent.error.code, 'VALIDATION_ERROR');
  const missing = await call('read', { path: 'missing.md' });
  assert.equal(missing.structuredContent.error.code, 'NOT_FOUND');
  const [ping, more] = await Promise.all([peer.request(id++, 'ping'), call('list', {})]);
  assert.deepEqual(ping.result, {});
  assert.equal(more.structuredContent.ok, true);
  peer.child.stdin.end();
  assert.equal((await peer.closed).stderr, '');
  peer.assertClean();
});

test('SDK scalar params are diagnosed while subsequent valid envelopes remain usable', async (t) => {
  const { peer } = await session(t);
  // No response is promised for malformed protocol envelopes; only wait for ping.
  peer.send({ jsonrpc: '2.0', id: 50, method: 'tools/list', params: 42 });
  assert.deepEqual((await peer.request(51, 'ping')).result, {});
  peer.child.stdin.end();
  const result = await peer.closed;
  assert.equal(result.code, 0);
  assert.match(result.stderr, /MCP_PROTOCOL_ERROR/);
  peer.assertClean();
});

for (const replacement of ['symlink', 'directory']) {
  test(`MCP rejects a replaced vault root: ${replacement}`, async (t) => {
    const { peer, cwd } = await session(t);
    const moved = cwd + '-original';
    const outside = cwd + '-outside';
    t.after(() => Promise.all([moved, outside].map((path) => rm(path, { recursive: true, force: true }))));
    await rename(cwd, moved);
    await mkdir(outside);
    await writeFile(join(outside, 'private.md'), 'OUTSIDE_SENTINEL');
    if (replacement === 'symlink') await symlink(outside, cwd);
    else { await mkdir(cwd); await writeFile(join(cwd, 'private.md'), 'OUTSIDE_SENTINEL'); }
    let id = 100;
    for (const [name, args] of [['list', {}], ['tree', {}], ['read', { path: 'private.md' }]]) {
      const reply = await peer.request(id++, 'tools/call', { name: 'mdwiki_' + name, arguments: args });
      assert.equal(reply.result.isError, true);
      assert.equal(reply.result.structuredContent.error.code, 'UNSAFE_PATH');
      assert.ok(!JSON.stringify(reply).includes('OUTSIDE_SENTINEL'));
    }
    assert.deepEqual((await peer.request(id, 'ping')).result, {});
    peer.child.stdin.end();
    assert.equal((await peer.closed).code, 0);
    peer.assertClean();
  });
}
