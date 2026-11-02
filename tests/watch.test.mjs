import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rename, rm, realpath, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { start, run, protocol } from './process-helpers.mjs';
const core = process.env.MDWIKI_TEST_CORE ?? new URL('../dist/', import.meta.url).pathname;
const { WatchSession } = await import(pathToFileURL(join(core, 'watch.js')));
const { initVault, selectVault } = await import(pathToFileURL(join(core, 'core/vault.js')));

async function fixture(t) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'mdwiki-watch-')));
  const cleanups = [];
  const scope = { after: cleanup => cleanups.push(cleanup) };
  t.after(async () => {
    const errors = [];
    for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch (error) { errors.push(error); } }
    await rm(scratch, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'fixture cleanup failed');
  });
  const vault = join(scratch, 'vault'), indexDir = join(scratch, 'cache');
  await mkdir(vault);
  await initVault({ vault, indexDir });
  const selected = await selectVault({ vault });
  return { scope, scratch, vault, indexDir, selected, put: (path, content) => writeFile(join(vault, path), content) };
}
function events(t, args, cwd) {
  const peer = start(t, args, cwd);
  const messages = [];
  let buffer = '', waiter;
  peer.child.stdout.on('data', chunk => {
    buffer += chunk;
    let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, n))); buffer = buffer.slice(n + 1);
    }
    waiter?.();
  });
  let offset = 0;
  const next = event => new Promise((resolve, reject) => {
    const check = () => {
      while (offset < messages.length) { const value = messages[offset++]; if (value.event === event) { waiter = undefined; resolve(value); return; } }
    };
    waiter = check; check();
    void peer.closed.then(() => { check(); reject(new Error('watch exited before ' + event)); }, reject);
  });
  return { ...peer, messages, next };
}
function handshake(t, description) {
  let resolve;
  const promise = new Promise((done, reject) => {
    resolve = done;
    const timer = setTimeout(() => reject(new Error(description)), 6000);
    t.after(() => clearTimeout(timer));
  });
  void promise.catch(() => {});
  return { promise, resolve };
}
function committed(t, directory, query) {
  let watcher, timer;
  const db = new DatabaseSync(join(directory, 'index.sqlite'), { readOnly: true });
  const result = new Promise((resolve, reject) => {
    const check = () => {
      try { if (query(db)) { clearTimeout(timer); watcher?.close(); resolve(); } }
      catch { /* An absent/in-flight cache has not committed the expected state. */ }
    };
    watcher = watch(directory, check);
    timer = setTimeout(() => { watcher.close(); reject(new Error('expected cache commit not observed')); }, 6000);
    check();
  });
  t.after(() => { clearTimeout(timer); watcher?.close(); db.close(); });
  return result;
}

test('watch JSONL announces ready, committed create/change/alias/rename/delete batches and orderly signals', async t => {
  const { scope, scratch, vault, put } = await fixture(t);
  await put('source.md', '[[nickname]]');
  const peer = events(scope, ['--vault', vault, 'watch', '--json'], scratch);
  const ready = await peer.next('ready');
  assert.equal(ready.data.vault, vault); assert.equal(typeof ready.data.generation, 'string');
  await put('target.md', '---\naliases: [nickname]\n---\nfreshword');
  let sync = await peer.next('sync'); assert.equal(sync.data.added, 1);
  let graph = JSON.parse((await run(scope, ['--vault', vault, 'backlinks', 'target.md', '--json'], scratch)).stdout);
  assert.equal(graph.data.generation, sync.data.generation);
  assert.deepEqual(graph.data.entries.map(e => e.path), ['source.md']);
  await put('target.md', '---\naliases: [other]\n---\nchangedword');
  sync = await peer.next('sync'); assert.equal(sync.data.changed, 1);
  graph = JSON.parse((await run(scope, ['--vault', vault, 'backlinks', 'target.md', '--json'], scratch)).stdout);
  assert.equal(graph.data.generation, sync.data.generation);
  assert.equal(graph.data.entries.length, 0);
  assert.equal(graph.data.link_diagnostics[0].code, 'MISSING_LINK');
  await rename(join(vault, 'target.md'), join(vault, 'renamed.md'));
  sync = await peer.next('sync'); assert.equal(sync.data.added, 1); assert.equal(sync.data.removed, 1);
  await rm(join(vault, 'renamed.md'));
  assert.equal((await peer.next('sync')).data.removed, 1);
  peer.child.kill('SIGTERM'); assert.equal((await peer.next('stopped')).data.reason, 'SIGTERM');
  const closed = await peer.closed; assert.equal(closed.code, 0); assert.equal(closed.stderr, '');
  for (const [i, event] of peer.messages.entries()) {
    assert.deepEqual(Object.keys(event).sort(), ['schema_version', 'event', 'sequence', 'timestamp', 'data', 'diagnostics', 'degraded'].sort());
    assert.equal(event.schema_version, 1); assert.equal(event.sequence, i + 1);
    assert.equal(new Date(event.timestamp).toISOString(), event.timestamp);
  }
});

for (const reason of ['SIGINT', 'EOF', 'stdout']) test(`active watch cleans up on ${reason}`, async t => {
  const { scope, scratch, vault } = await fixture(t);
  const peer = events(scope, ['watch', '--vault', vault, '--json'], scratch);
  await peer.next('ready');
  if (reason === 'stdout') {
    peer.child.stdout.destroy();
    // Closing the reader is observed at the next write, as with ordinary pipes.
    await writeFile(join(vault, 'wake.md'), 'wake');
  } else if (reason === 'EOF') peer.child.stdin.end();
  else peer.child.kill(reason);
  const closed = await peer.closed;
  assert.equal(closed.code, 0); assert.equal(closed.stderr, '');
  if (reason !== 'stdout') assert.equal(peer.messages.at(-1).event, 'stopped');
});

test('watch text is readable and fatal startup uses event envelope and exit 5', async t => {
  const { scope, scratch, vault } = await fixture(t);
  const peer = start(scope, ['watch', '--vault', vault], scratch);
  await new Promise(resolve => peer.child.stdout.once('data', resolve));
  peer.child.stdin.end();
  const result = await peer.closed;
  assert.match(result.stdout, /^ready: /); assert.match(result.stdout, /stopped: /); assert.equal(result.code, 0);
  const failed = await run(scope, ['watch', '--vault', join(scratch, 'absent'), '--json'], scratch);
  assert.equal(failed.code, 5);
  const error = JSON.parse(failed.stdout); assert.equal(error.event, 'error'); assert.equal(error.sequence, 1); assert.equal(error.degraded, true);
});

for (const stop of ['EOF', 'SIGTERM', 'stdout']) test(`initialized MCP watches without another request and closes active resources on ${stop}`, async t => {
  const { scope, vault, put, indexDir } = await fixture(t);
  await put('a.md', 'oldword');
  const peer = protocol(scope, vault);
  await peer.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'watch', version: '1' } });
  peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (id, name, args) => peer.request(id, 'tools/call', { name: 'mdwiki_' + name, arguments: args });
  assert.equal((await call(2, 'search', { query: 'oldword' })).result.structuredContent.data.entries.length, 1);
  const changed = committed(scope, indexDir, db => db.prepare("SELECT count(*) AS n FROM documents WHERE documents MATCH 'newword'").get().n === 1);
  await put('a.md', 'newword'); await changed;
  const result = await call(3, 'search', { query: 'newword' });
  assert.equal(result.result.structuredContent.data.entries.length, 1);
  if (stop === 'EOF') peer.child.stdin.end();
  else if (stop === 'stdout') { peer.child.stdout.destroy(); peer.send({ jsonrpc: '2.0', id: 4, method: 'ping' }); }
  else peer.child.kill(stop);
  assert.equal((await peer.closed).code, 0);
  if (stop !== 'stdout') peer.assertClean();
});

test('controlled attachment race, quiet scans, missed notifications and transient watcher reattachment', async t => {
  const { scope, selected, put, indexDir } = await fixture(t);
  await put('a.md', 'oldword');
  const emitted = [];
  let dirty, failed, attachments = 0;
  const attach = async (_vault, changed, error) => {
    dirty = changed; failed = error; attachments++;
    if (attachments === 1) { await put('a.md', 'startupword'); changed(); }
    const handle = new EventEmitter(); handle.close = () => {}; return handle;
  };
  const session = new WatchSession(selected, { attach, interval: 40, debounce: 0, emit: e => emitted.push(e) });
  scope.after(() => session.close());
  assert.equal((await session.run({ search: { query: 'startupword' } })).data.entries.length, 1);
  const n = emitted.length; await session.run(); assert.equal(emitted.length, n);
  // No dirty callback: only the periodic fallback can find this change.
  const recovered = committed(scope, indexDir, db => db.prepare("SELECT count(*) AS n FROM documents WHERE documents MATCH 'missedword'").get().n === 1);
  await put('a.md', 'missedword'); await recovered;
  assert.ok(emitted.some(e => e.event === 'sync' && e.data.changed === 1));
  failed(new Error('controlled transient watcher failure'));
  await put('a.md', 'reattached'); dirty();
  assert.equal((await session.run({ search: { query: 'reattached' } })).data.entries.length, 1);
  assert.equal(attachments, 2); assert.ok(emitted.some(e => e.data.code === 'WATCH_UNAVAILABLE' && e.data.retry));
});

test('dirty work arriving during scan is awaited before an indexed response', async t => {
  const { scope, selected, put, vault } = await fixture(t);
  await put('a.md', 'oldword'); await put('b.md', 'unchanged');
  let dirty;
  const session = new WatchSession(selected, { attach: async (_vault, changed) => { dirty = changed; return { close() {} }; }, interval: 60000 });
  scope.after(() => session.close());
  await session.run();
  const original = fs.open;
  let injected = false;
  const mock = t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(vault, 'b.md') && !injected) { injected = true; await put('a.md', 'newword'); dirty(); }
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try { assert.equal((await session.run({ search: { query: 'newword' } })).data.entries.length, 1); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test('active watch repairs missing/corrupt/incompatible data cache and preserves unrelated external files', async t => {
  const { scope, selected, put, indexDir } = await fixture(t);
  await put('a.md', 'truthword'); await writeFile(join(indexDir, 'sentinel'), 'preserve');
  const emitted = [];
  let recovered;
  const session = new WatchSession(selected, { interval: 60000, emit: e => { emitted.push(e); if (e.event === 'sync' && e.data.added === 1) recovered?.(); } });
  scope.after(() => session.close());
  await session.run();
  const coordinator = await stat(join(indexDir, 'coordinator.sqlite'));
  await rm(join(indexDir, 'index.sqlite'));
  assert.equal((await session.run()).data.added, 1);
  for (const corrupt of [true, false]) {
    if (corrupt) await writeFile(join(indexDir, 'index.sqlite'), 'corrupt');
    else { const db = new DatabaseSync(join(indexDir, 'index.sqlite')); db.exec('PRAGMA user_version=999'); db.close(); }
    // The call reports failure; a background retry must publish recovery autonomously.
    const event = handshake(scope, 'automatic cache recovery not observed');
    recovered = event.resolve;
    try {
      await assert.rejects(() => session.run(), /reindex --full/);
      await event.promise;
      assert.equal((await session.run({ search: { query: 'truthword' } })).data.entries.length, 1);
    } finally { recovered = undefined; }
  }
  assert.ok(emitted.some(e => e.data.code === 'CACHE_REBUILD'));
  assert.equal((await stat(join(indexDir, 'coordinator.sqlite'))).ino, coordinator.ino);
  assert.equal(await readFile(join(indexDir, 'sentinel'), 'utf8'), 'preserve');
});

test('persistent attachment failure retries a bounded number of times then releases resources with fatal error', async t => {
  const { scope, selected } = await fixture(t);
  const emitted = [];
  let attempts = 0;
  const { promise: fatal, resolve: resolveFatal } = handshake(scope, 'fatal retry exhaustion not observed');
  const session = new WatchSession(selected, { attach: async () => { attempts++; throw new Error('injected attach failure'); }, emit: e => { emitted.push(e); if (e.event === 'error') resolveFatal(); } });
  scope.after(() => session.close());
  await assert.rejects(() => session.run()); await fatal;
  assert.equal(attempts, 3); assert.deepEqual(emitted.map(e => e.event), ['diagnostic', 'diagnostic', 'error']);
  assert.equal(emitted[0].data.retry, true); assert.equal(emitted[1].data.retry_ms, 500);
});

test('unreadable watched notes exclude stale content, deduplicate diagnostics, and recover', async t => {
  const { scope, selected, vault, put } = await fixture(t);
  await put('a.md', 'stalecontent');
  const emitted = [];
  const session = new WatchSession(selected, { interval: 60000, emit: e => emitted.push(e) });
  scope.after(() => session.close());
  await session.run();
  const original = fs.open;
  const mock = t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(vault, 'a.md')) throw Object.assign(new Error('injected denied read'), { code: 'EACCES' });
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    const excluded = await session.run({ search: { query: 'stalecontent' } });
    assert.equal(excluded.data.entries.length, 0); assert.equal(excluded.degraded, true);
    assert.equal(excluded.diagnostics[0].code, 'UNREADABLE_NOTE');
    const count = emitted.length; await session.run(); assert.equal(emitted.length, count);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal((await session.run({ search: { query: 'stalecontent' } })).data.entries.length, 1);
});

test('file publication survives watcher attachment failure and background recovery indexes it once', async t => {
  const { scope, selected, vault } = await fixture(t);
  const { operate } = await import(pathToFileURL(join(core, 'operations.js')));
  const { attach } = await import(pathToFileURL(join(core, 'core/watch.js')));
  let attempts = 0;
  const { promise: recovered, resolve: ready } = handshake(scope, 'background ready not observed');
  const session = new WatchSession(selected, { attach: async (...args) => {
    if (++attempts === 1) throw new Error('controlled startup failure');
    return attach(...args);
  }, emit: e => { if (e.event === 'ready') ready(); } });
  scope.after(() => session.close());
  const result = await operate(selected, 'write', { path: 'a.md', content: 'publishedonce' }, (_vault, input) => session.run(input));
  assert.equal(result.ok, true); assert.equal(result.degraded, true);
  assert.equal(result.data.file_written, true); assert.equal(result.data.index.ok, false);
  assert.match(result.diagnostics[0].message, /File write succeeded; do not retry append/);
  await recovered;
  assert.equal(attempts, 2);
  assert.equal((await session.run({ search: { query: 'publishedonce' } })).data.entries.length, 1);
  assert.equal((await readFile(join(vault, 'a.md'), 'utf8')).match(/publishedonce/g).length, 1);
});

test('killed staged rebuild releases stable coordinator; live holder excludes readers and recovery publishes complete files', async t => {
  const { scope, scratch, vault, selected, put, indexDir } = await fixture(t);
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { indexed } = await import(pathToFileURL(join(core, 'index/cache.js')));
  await put('a.md', 'beforeword'); await indexed(selected);
  const lock = await stat(join(indexDir, 'coordinator.sqlite'));
  await put('a.md', 'afterword'); await put('b.md', 'afterword');
  const code = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { selectVault } from ${JSON.stringify(pathToFileURL(join(core, 'core/vault.js')).href)};
    import { indexed } from ${JSON.stringify(pathToFileURL(join(core, 'index/cache.js')).href)};
    const original = fs.rename;
    fs.rename = async (...args) => {
      if (args[0].includes('rebuild-')) {
        process.stdout.write('staged\\n');
        await new Promise(resolve => process.stdin.once('data', resolve));
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    await indexed(await selectVault({vault: ${JSON.stringify(vault)}}), {full:true});
    process.stdin.pause();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  scope.after(async () => { clearTimeout(timer); child.kill('SIGKILL'); await closed; });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const handshake = await Promise.race([once(child.stdout, 'data').then(([chunk]) => chunk.toString()), closed.then(() => { throw new Error('rebuild died before staging: ' + stderr); })]);
  assert.equal(handshake, 'staged\n');
  const blocked = await run(scope, ['--vault', vault, 'search', 'afterword', '--json'], scratch);
  assert.equal(blocked.code, 5); assert.match(JSON.parse(blocked.stdout).error.message, /Do not remove a live coordinator/);
  const db = new DatabaseSync(join(indexDir, 'index.sqlite'), { readOnly: true });
  assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE documents MATCH 'beforeword'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE documents MATCH 'afterword'").get().n, 0); db.close();
  assert.equal((await stat(join(indexDir, 'coordinator.sqlite'))).ino, lock.ino);
  child.kill('SIGKILL'); assert.deepEqual(await closed, [null, 'SIGKILL']); clearTimeout(timer);
  const rebuilt = await run(scope, ['--vault', vault, 'reindex', '--full', '--json'], scratch);
  assert.equal(rebuilt.code, 0, rebuilt.stderr + rebuilt.stdout); assert.equal(JSON.parse(rebuilt.stdout).data.added, 2);
  const readers = await Promise.all([run(scope, ['--vault', vault, 'search', 'afterword', '--json'], scratch), run(scope, ['--vault', vault, 'reindex', '--full', '--json'], scratch)]);
  assert.equal(readers[0].code, 0); assert.equal(readers[1].code, 0);
  assert.equal(JSON.parse(readers[0].stdout).data.entries.length, 2);
  assert.equal((await stat(join(indexDir, 'coordinator.sqlite'))).ino, lock.ino);
});

test('shutdown during initial attachment closes the late handle without starting cache work', async t => {
  const { scope, selected, indexDir } = await fixture(t);
  let attached, finish, closed = 0;
  const attaching = new Promise(resolve => { attached = resolve; });
  const barrier = new Promise(resolve => { finish = resolve; });
  const emitted = [];
  const session = new WatchSession(selected, { attach: async () => {
    attached(); await barrier; return { close() { closed++; } };
  }, emit: e => emitted.push(e) });
  scope.after(() => session.close());
  const run = session.run();
  const rejected = assert.rejects(() => run, /Watcher has stopped/);
  await attaching;
  const stopping = session.close('controlled shutdown');
  finish(); await stopping; await rejected;
  assert.equal(closed, 1); assert.deepEqual(emitted.map(e => e.event), ['stopped']);
  await assert.rejects(() => stat(join(indexDir, 'index.sqlite')), e => e.code === 'ENOENT');
});

test('fatal runtime watch failure emits error, preserves files and exits 5 after bounded retries', async t => {
  const { scope, scratch, vault, indexDir, put } = await fixture(t);
  const peer = events(scope, ['watch', '--vault', vault, '--json'], scratch);
  await peer.next('ready');
  await rm(join(indexDir, 'index.sqlite')); await mkdir(join(indexDir, 'index.sqlite'));
  await put('trigger.md', 'filetruth');
  const error = await peer.next('error');
  assert.equal(error.data.code, 'UNSAFE_PATH'); assert.equal(error.degraded, true);
  assert.match(error.data.message, /Watching stopped.*restart this process/);
  const closed = await peer.closed; assert.equal(closed.code, 5); assert.equal(closed.stderr, '');
  assert.equal(peer.messages.filter(e => e.event === 'diagnostic').length, 2);
  assert.equal(peer.messages.filter(e => e.event === 'sync' || e.event === 'stopped').length, 0);
  assert.equal(await readFile(join(vault, 'trigger.md'), 'utf8'), 'filetruth');
});

test('queued post-publication reconciliation marks an in-flight indexed response dirty before OS notification', async t => {
  const { scope, selected, put, vault } = await fixture(t);
  await put('a.md', 'oldword'); await put('b.md', 'unchanged');
  const session = new WatchSession(selected, { attach: async () => ({ close() {} }), interval: 60000 });
  scope.after(() => session.close());
  await session.run();
  const original = fs.open;
  let queued;
  const mock = t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(vault, 'b.md') && !queued) {
      await put('a.md', 'publishedword');
      queued = session.run();
    }
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await session.run({ search: { query: 'publishedword' } });
    assert.equal(result.data.entries.length, 1); await queued;
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});
