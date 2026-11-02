# M2 10,000-note baseline

Run from this checkout with Node 26.13.0 / npm 11.20.0:

```sh
npm ci
npm run benchmark
```

The command builds, creates a disposable `mkdtemp` vault/cache, generates exactly
100 folders with 100 notes each, runs cold indexing, unchanged reconciliation and
one search in fresh Node processes, then removes its scratch data in `finally`.
Each worker is bounded to 120 seconds. Notes contain deterministic YAML scalar
values, tags, headings and repeated prose; no personal data or network runtime.
The fixture has 10,476,780 note bytes; notes plus cache total 31,325,652 logical
bytes (about 59 MiB allocated on this machine's tmpfs), below 100 MiB. The script
asserts generated logical size and never changes HOME/CODEX_HOME. An interrupted
parent may leave its printed/process-argument `mdwiki-benchmark-*` scratch directory;
remove only that owned directory after its processes stop.

Measured 2026-11-02 on host `omarchy`, Linux x86_64, kernel 7.2.8-9-omarchy,
AMD Ryzen 7 7730U with Radeon Graphics, 16 logical CPUs, 13.5 GiB RAM,
Node v26.13.0, npm 11.20.0. Fixture and SQLite were on `/tmp` tmpfs.
M2 merged in PR #15; no macOS performance claim.

| Operation | Elapsed | Peak process RSS | Observable result |
|---|---:|---:|---|
| Cold index (no data DB) | 11,722 ms | 127.1 MiB | 10,000 added |
| Unchanged reconciliation | 9,055 ms | 97.5 MiB | 10,000 unchanged, 0 added |
| Search including reconciliation | 10,650 ms | 97.5 MiB | 50 hits, phrase plus exact tag |

Elapsed time covers the application operation after vault selection; Node startup
and fixture generation are excluded. Peak RSS is `resourceUsage().maxRSS` for the
fresh worker (includes startup). Search is `"calibration sample"` with exact tag
`benchmark`, limit 50. Timings include the required read/hash reconciliation;
they are user-visible indexed-call latency, not isolated FTS-only latency. “Cold”
means an absent mdwiki data DB, not a flushed OS page cache. This is one baseline
run, not a statistical guarantee or a comparison to M1 (which had no index/search).

For M6, rerun the same fixture/command and record the machine/runtime/filesystem.
On this machine use investigation budgets of **25 s cold**, **20 s unchanged**,
**22 s search including sync**, and **256 MiB peak RSS** per worker. These are
roughly twice the observed baseline, allowing ordinary load variation while
making large regressions visible. Exceeding a budget calls for repeat measurement
and investigation, not an automatic functional-test failure. Compare macOS and
other hardware to their own recorded baselines before setting platform budgets.
No timing assertions belong in the acceptance suite. M5 watching should reduce
indexed-call reconciliation costs; record that separately without changing this
fixture to conceal regressions.
