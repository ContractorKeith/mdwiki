# M5 ordinary branch review

Compared the complete M5 working-tree artifact to base `bc31ce5` on 2026-11-02,
including new watch modules/tests and all changed documentation. Reviewed against
AGENTS.md, CONTEXT.md, issue #6, the entire v0.1 SPEC and development/verification
contracts. Two sequential inspection passes; no delegated or adversarial campaign.
M5 is implemented pending parent review and actual Linux/macOS CI.

## Standards

No unresolved findings after fixes. Filesystem notification exclusions/attachment
remain in core, SQL and committed-batch reporting remain in index, and the shared
application lifecycle owns synchronization/retry policy. Transports translate
lifecycle/output only. No dependency or schema change. Index connections close
before releasing the existing stable coordinator. Mutation publication finishes
and releases its separate vault-local lock before watcher/index work begins.

Inspection found and fixed late-attachment shutdown leaking a handle, repeated
unsafe-path scan failures bypassing lifecycle diagnostics, and post-publication
reconciliation queued before OS notification allowing an in-flight stale response.
Each has a deterministic regression test. The watch-event fixture now inspects
graph results through the coordinated CLI and pins its generation, rather than
opening a raw SQLite reader while a producer may still be closing.
Owned fixture cleanup closes lifecycle handles, observers and children before
removing their directory; this fixes a deterministic filesystem cleanup race seen
on the workspace filesystem. SDK-owned transport close also releases
the lifecycle. No coordinator deletion, external directory erasure, or note rewrite
was added. Ordinary full-diff inspection is not an independent review approval.

## Spec

No unresolved implementation gap found against #6 and the v0.1 watch contract.
The 48 prior tests remain, with the help command list extended and corruption
fixtures stopping autonomous MCP activity before deliberately damaging cache files.
Preview snapshots now also include initialized MCP list/tree/read calls with a
missing external cache. Eighteen M5 scenarios bring the suite to 66 tests, run both
from source and through the isolated installed tarball.

Evidence covers external create/edit/delete/rename/alias graph changes, exact
JSONL fields/sequence/UTC timestamps/counts, text output, ready and quiet scans,
fatal startup/runtime exit 5, signals/EOF/closed stdout, active MCP background cache
commits, attachment and dirty-response races, controlled missed notifications,
transient reattachment, bounded retry exhaustion, inaccessible-note exclusion,
automatic deleted/corrupt/incompatible cache recovery, and successful publication
when watcher startup fails. A real staged rebuild is held before publication:
a reader times out while the live holder remains intact, old contents stay whole,
SIGKILL releases ownership, and a concurrent reader/rebuild sees complete recovery.
M4 live writer, crash recovery and cooperating different-cache append proofs remain.
Every child has a timeout/cleanup; correctness waits on events/commits, not sleeps.

## Limits and handoff

Every indexed call still reads/hashes the vault. Periodic scans run every five
seconds; one background pass is queued at a time. Continuous edits can extend a
call while it drains known dirty work. Shutdown awaits an in-flight scan or bounded
SQLite wait; it does not cancel arbitrary kernel I/O. Filesystem notifications may
be unreliable on network/virtual filesystems. External editors and direct deletion
of live coordination files are outside the cooperative protocol.

Fatal watch exhaustion requires fixing the cause and restarting the process;
MCP still permits direct reads but rejects indexed operations instead of serving
stale content. Corrupt coordinators and abandoned staging/write temps require the
documented stopped-process manual recovery. The unchanged 10k benchmark measures
CLI indexing/search, not graph-heavy, watch-scale or mutation throughput. Local
Linux evidence is not macOS evidence; both actual CI jobs remain the parent's
integration gate. No ready/merge/release/publication action is part of this branch.


## Executed verification

Linux Node 26.13.0/npm 11.20.0: isolated `npm ci` passed; unchanged
`bash scripts/accept.sh` passed typecheck/lint/build, 66 source tests and the same
66 installed-package tests; `npm run benchmark` passed the unchanged fixture and
all investigation budgets; `git diff --check` passed. Final commands used explicit
npm config/cache/prefix and an owned workspace TMPDIR after shared tmpfs quota
failures. See [benchmark evidence](BENCHMARK.md) for exact measurements and the
filesystem comparison limitation. Parent must rerun the gate and verify actual
Linux/macOS CI before integration; this self-inspection is not a PR approval.

## Parent integration outcome

PR #18 merged as `f683d4e` after ordinary parent full-diff inspection, acceptance
(66 source +66 installed tests), unchanged benchmark and all final-head Linux/macOS
CI passed at `0d9a9cd`. Merge tree matched the tested head. Parent benchmark used
owned `/home` btrfs scratch: cold14955ms/133.8MiB, unchanged10243ms/103.6MiB,
search+sync16845ms/103.6MiB; all original investigation budgets met. Runtime audit
was clean; development-chain findings are carried into M6's dependency inventory.
