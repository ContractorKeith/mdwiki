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

## M3 integration comparison

Reran the unchanged command/fixture on 2026-11-02 on the same Omarchy host,
Node/npm and `/tmp` tmpfs described above. Notes remain 10,476,780 bytes; total
fixture/cache size is 31,333,844 logical bytes. No script or budget changes.

| Operation | M3 elapsed | M3 peak RSS | Observable result |
|---|---:|---:|---|
| Cold index | 11,708 ms | 135.3 MiB | 10,000 added |
| Unchanged reconciliation | 9,655 ms | 101.0 MiB | 10,000 unchanged, 0 added |
| Search including reconciliation | 9,809 ms | 113.3 MiB | 50 hits |

All remain within the existing investigation budgets. Relative to the single M2
run, unchanged sync took 600 ms longer and the largest RSS increase was 15.8 MiB
for search; cold/search elapsed times were lower. These single runs do not establish
statistical performance equivalence. This fixture contains no wikilinks: the M3
parser skips Markdown AST construction when `[[` is absent, so this measures
integration/startup/schema overhead, not graph-heavy parsing or resolution cost.
Bounded graph fixtures exercise correctness separately. No macOS benchmark claim.

## M4 integration comparison

Reran the unchanged command/fixture on 2026-11-02 on the same Omarchy Linux host,
Node v26.13.0/npm 11.20.0 and `/tmp` tmpfs. Exactly 10,000 notes in 100 folders:
10,476,780 note bytes and 31,333,844 total logical fixture/cache bytes. The fixture,
worker limits and investigation budgets are unchanged.

| Operation | M4 elapsed | M4 peak RSS | Observable result |
|---|---:|---:|---|
| Cold index | 11,259 ms | 134.9 MiB | 10,000 added |
| Unchanged reconciliation | 9,109 ms | 99.9 MiB | 10,000 unchanged, 0 added |
| Search including reconciliation | 9,674 ms | 99.9 MiB | 50 hits |

All are within existing budgets. Against the recorded M3 run, elapsed times were
449/546/135 ms lower respectively; RSS was 0.4/1.1/13.4 MiB lower. These single
runs do not establish statistical equivalence or a speedup. No graph-heavy or
mutation-throughput workload is measured, and no macOS benchmark claim is made.
M4 correctness is checked separately with bounded deterministic write fixtures.
