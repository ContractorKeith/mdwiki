# M6 release evidence and sequential review

Reviewed worktree against base `977eb1a1dca8e8f7e40cab06d1b5b5e18ec9f3d4` (M5).
The draft PR pins the final head. Intent: fulfill issue #7 with executable package
workflows, complete acceptance/dependency documentation and measured release evidence.
No unrelated/pre-existing changes were present.

## Standards

No remaining supported findings in the complete scoped diff. Sequential inspection
covered every changed file and its callers/tests, including newly added files.
Application source, dependency lock and benchmark script are unchanged. Small test/
package/example additions use bounded disposable fixtures and reap subprocesses;
installed execution excludes user/global npm bin paths and NODE_PATH. No dependency,
coordinator ownership, path/conflict rule or lazy-activation change was introduced.
The workflow source harness needed a temporary executable wrapper around compiled
JavaScript (npm sets executable mode when installed); that was corrected before the
gate. The package check initially failed for missing docs, then passed after shipping
them. Whitespace/lint/type checks pass.

## Spec

No remaining identified functional coverage gap after mapping all eleven required
acceptance rows, all v0.1 feature rows and eleven user stories in ACCEPTANCE.md.
A new 205-note transport test closes full-size search pagination/tie coverage.
Shipped runnable examples close the old use-after-cleanup README example and prove
CLI and initialized MCP workflows using the installed executable. The artifact
allowlist includes executable/license/operational docs/examples and excludes source
tests, scratch, private data and node_modules. Existing preview snapshots, published
write success after index failure, live/killed coordinator and exact-path tests all
remain. No assertion of a documentation status sentence substitutes for behavior.

## Executed evidence

On 2026-11-02, Omarchy Linux x64, Node v26.13.0/npm 11.20.0:

- `npm ci`: 135 dependencies installed; no dependency changes.
- `bash scripts/accept.sh`: typecheck, lint, build, **70 source + 70 installed
  tests passed**, zero skipped/failed; all previous 66 + 66 retained.
- `npm run benchmark`: unchanged fixture/script/budgets, serially after a passing
  gate; 12,019 / 9,748 / 9,788 ms, RSS 133.7 / 112.3 / 112.2 MiB. All budgets
  pass; machine, btrfs comparison and scope limits are in BENCHMARK.md. The final
  gate was rerun after recording those docs; no application/benchmark code changed.
- `git diff --check` and full-diff sequential Standards then Spec inspection.
- Read-only npm registry/auth and audit commands: see DEVELOPMENT.md. Runtime
  audit zero; full audit 11 moderate development-only minimatch-chain findings.
  Actual installed runtime versions/licenses matched the audited lock inventory.

Owned TMPDIR/npm cache/config/prefix lived beneath a workspace mkdtemp directory
on `/home` btrfs; shared /tmp previously hit errno -122 quota. Fixtures/cache/prefix
were removed only after child exits. No HOME/CODEX_HOME changes or real vaults.

Tested tarball (not committed):
`/home/contractorkeith/.cache/mdwiki-m6/artifacts/mdwiki-0.1.0.tgz`

SHA-256: `08295b4bac30f6b7d287ed2a5c3f3823e1fdecf3dcf51255c122d33c8cc49823`.
Size: 64,221 packed bytes / 212,783 unpacked bytes;
34 files. `artifact.json` beside it contains the complete npm manifest,
actual installed dependency versions/licenses and platform/suite result. Retained
`final-accept.log`, `benchmark.log`, `runtime-audit.json`, `full-audit.json`,
`registry.json`, `auth-error.txt` are in the same directory. This report is outside
the package allowlist so recording its checksum does not change the tarball.

Reproduce with an owned workspace mkdtemp directory and empty npm configs as in
USAGE.md, then `npm ci`; set `MDWIKI_ARTIFACT_DIR` to a separate owned evidence
directory and run `bash scripts/accept.sh`, followed serially by
`npm run benchmark`; verify SHA-256 and `tar -tzf` against artifact.json. No global
application packages or runtime network access are needed. Dependency download
requires registry access; later transitive resolutions can differ and need re-audit.

## Remaining release constraints

Local Linux is verified; actual final-SHA ubuntu-latest and macos-latest CI results
must be checked on the PR. No local macOS claim. Parent review/reproduction and
release authorization remain pending. Registry E404/unpublished is not claimability;
isolated ENEEDAUTH is not publisher access or a survey of existing credentials.
No publication, tag, ready/merge, watch, delegates, central worklog or Basecamp action.
No graph-heavy/watch-scale/mutation-throughput performance claim. External editor
atomic compare-and-swap is not promised; filesystem notification limits remain.

## Parent integration outcome

Merged PR #19 as `a8cff09` after parent full-diff inspection, npm ci, acceptance
(70 source +70 installed; zero failures/skips), whitespace checks and all final-head
Linux/macOS CI passed at `ca278bc`. Merge tree equals tested head. Independently
produced parent tarball is byte-identical to the checksum above;34-file manifest
and all39 actual runtime dependency versions/licenses verified against the lock.
Parent artifact retained at `/home/contractorkeith/.cache/mdwiki-m6-parent/artifacts/`.
Parent serial benchmark on owned btrfs scratch: cold14206ms/133.5MiB,
unchanged9998ms/104.4MiB, search+sync9735ms/104.4MiB; all budgets passed.
Scratch cleaned. M6 integration is complete; no release tag or npm publication.
