import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { initVault, selectVault } from '../dist/core/vault.js';
import { operate } from '../dist/operations.js';

// Fresh processes make peak RSS comparable across operations. All search timings
// include mandatory reconciliation; this is the current user-visible latency.
if (process.argv[2] === '--worker') {
  const [, , , vault, indexDir, operation] = process.argv;
  const selected = await selectVault({ vault, indexDir });
  const start = performance.now();
  const result = await operate(selected, operation, operation === 'search' ? { query: '"calibration sample"', tags: ['benchmark'], limit: 50 } : {});
  assert.equal(result.degraded, false);
  if (operation === 'search') assert.equal(result.data.entries.length, 50);
  console.log(JSON.stringify({ elapsed_ms: Math.round(performance.now() - start), peak_rss_mib: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    ...(operation === 'reindex' ? { added: result.data.added, unchanged: result.data.unchanged } : { hits: result.data.entries.length }) }));
} else {
  const scratch = await mkdtemp(join(tmpdir(), 'mdwiki-benchmark-'));
  try {
    const vault = join(scratch, 'vault');
    const indexDir = join(scratch, 'cache');
    await mkdir(vault);
    let bytes = 0;
    for (let group = 0; group < 100; group++) {
      const folder = join(vault, `group-${String(group).padStart(3, '0')}`);
      await mkdir(folder);
      for (let note = 0; note < 100; note++) {
        const id = group * 100 + note;
        const content = `---\ntitle: Calibration ${id}\ntags: [benchmark, group-${group}]\ncustom: {stage: sample, flags: [true, null, 9007199254740993]}\n---\n# Calibration ${id}\nThis calibration sample documents repeatable indexing and search.\n${'Ordinary deterministic Markdown content for a disposable measurement.\n'.repeat(12)}`;
        bytes += Buffer.byteLength(content);
        await writeFile(join(folder, `note-${String(note).padStart(3, '0')}.md`), content);
      }
    }
    assert.ok(bytes < 20 * 1024 * 1024); // Leaves ample room for SQLite below 100 MiB.
    await initVault({ vault, indexDir });
    function measure(operation) {
      const child = spawnSync(process.execPath, [import.meta.filename, '--worker', vault, indexDir, operation], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stdout + child.stderr);
      return JSON.parse(child.stdout);
    }
    const npm = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(npm.status, 0);
    const cold = measure('reindex');
    const unchanged = measure('reindex');
    const search = measure('search');
    // Bound total generated files, including SQLite and its coordinator.
    const { readdir, stat } = await import('node:fs/promises');
    async function size(path) {
      let total = 0;
      for (const entry of await readdir(path, { withFileTypes: true })) total += entry.isDirectory() ? await size(join(path, entry.name)) : (await stat(join(path, entry.name))).size;
      return total;
    }
    const totalBytes = await size(scratch);
    assert.ok(totalBytes < 100 * 1024 * 1024);
    console.log(JSON.stringify({ machine: { hostname: hostname(), platform: platform(), arch: process.arch, kernel: release(), cpu: cpus()[0]?.model, logical_cpus: cpus().length, ram_gib: +(totalmem() / 1024 ** 3).toFixed(1), node: process.version, npm: npm.stdout.trim() }, fixture: { notes: 10000, folders: 100, note_bytes: bytes, total_bytes: totalBytes }, cold_index: cold, unchanged_sync: unchanged, search_with_sync: search }, null, 2));
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
