---
name: verification-env
description: Build and verify mdwiki with bounded deterministic disposable fixtures on macOS and Linux.
---

# mdwiki verification environment

Read AGENTS.md, docs/PLAN.md, and docs/features/v0.1/SPEC.md. Record the target
SHA and inspect the full branch diff for standards and spec compliance. Use
ordinary code inspection and bounded deterministic regression/acceptance checks.
mdwiki does not use pr-attack or skeptic-review, even when global skills suggest
them. Do not run adversarial campaigns or probabilistic filesystem flippers.

## Build and test

Node >=26.13.0 <27 is required; .nvmrc pins 26.13.0 LTS. Development uses
npm 11.20.0. Run `npm ci`, then `bash scripts/accept.sh`: typecheck, lint,
build, tests, npm pack, isolated prefix install, and installed CLI/MCP/SQLite tests.
Individual commands and dependency rationale are in docs/DEVELOPMENT.md.

M0 and M1 are merged; M2 index/search is merged in PR #15; M3 backlinks is merged in PR #16. Verify help/version,
text/JSON envelopes, validation errors, real MCP initialize/list-tools (exactly
mdwiki_list, mdwiki_tree, mdwiki_read, mdwiki_search, mdwiki_backlinks, mdwiki_write, mdwiki_append, mdwiki_reindex), invalid arguments, unknown tools,
EOF/SIGINT/SIGTERM shutdown, and vault-bound SQLite FTS5/schema recovery.
Installed tests use prefix/bin/mdwiki with explicit npm prefix/cache/config paths.
Verify AND words/phrases, punctuation, all indexed fields, exact repeated tags,
excerpts, stale cursors, restored-mtime edits, unreadable notes, deleted/corrupt/old
data caches and concurrent full rebuilds. Run `npm run benchmark` for the disposable
10,000-note baseline; see docs/BENCHMARK.md. M4 writes are merged in PR #17; M5 watching/recovery is merged in PR #18.

## Isolation

Create disposable scratch vaults and an isolated npm installation prefix. Pass
explicit `--vault` and `--index-dir` paths. Never access ~/vault, ~/Documents,
or other real notes. Do not repurpose HOME or CODEX_HOME. Clean only scratch
files you created. Keep fixtures under 100 MiB; /tmp may be shared memory storage.
If shared /tmp is quota-limited, set TMPDIR to an owned mkdtemp directory on the
workspace filesystem and remove it after children stop. Record the filesystem
change alongside benchmark timings; do not change fixtures or budgets.
Use controlled fixture transitions for filesystem regressions, with no fixed
sleeps as correctness evidence. Checks do not promise atomic exclusion against
arbitrary concurrent external editors.

## Product coverage

Use the existing suite and small focused fixtures for relevant behavior:

- Paths: traversal/hidden exclusions, symlinked parents/notes/cache, case/Unicode,
  exact list/read parity, external cache binding, pagination and bounded trees.
- Notes: original bytes/text, CRLF/BOM, content versions, size/UTF-8 limits, YAML
  comments/custom fields, malformed YAML and duplicate managed keys.
- MCP: real initialization, argument validation, unknown tools, concurrent calls,
  stdout/stderr separation and shutdown. Keep stdin open until expected replies.
- Packaging: fresh npm tarball install, documented commands and bounded output.
- Writes: stale versions, cooperating writers, dry-run side effects,
  interruption recovery, mode preservation and cache invalidation.
- Index and later watch: deleted/corrupt/old schema, recovery, permissions, missed
  events and orderly shutdown.
- Search and graph: title/path/body/frontmatter, tags, phrases/punctuation,
  ambiguous links, aliases, code/comments and target changes.

## Platform evidence

Linux and macOS installed-package verification are both required before release;
both CI jobs must pass before merge. APFS may be case- and normalization-insensitive;
macOS temporary paths may have system symlink ancestors. Report the actual machine,
Node version, target SHA, checks run and limitations. Code inspection alone does
not establish a platform result. Record confirmed findings with deterministic
regression evidence; the orchestrator handles integration and central worklogs.

## M3 backlinks

Verify source-folder/root/name/alias precedence, per-stage ambiguity, string/string
sequence aliases with original YAML types, optional `.md`, exact extension/case/
Unicode spelling, fragments (including same-note), note embeds, invalid hidden/
traversing targets, Markdown code containers and frontmatter/comment exclusions.
Reconcile target/alias add/remove/rename with unchanged sources; verify graph batch
rollback, unreadable exclusion and schema v2 refusal/full recovery without note edits.
Backlinks pages bound the sum of entries and vault-wide link_diagnostics to limit
(default 50, max 200); candidates cap at 200 with candidate_count, context at 320.
Page through diagnostics-only pages. Bind cursors to target/vault/generation/limit;
reject malformed, mismatched and stale tokens. Check exact initialized tool list and
installed CLI/MCP structured parity/errors. Link diagnostics do not themselves mark
an otherwise complete operation degraded. Benchmark fixture/budgets remain unchanged;
it contains no links, so report that graph-heavy throughput is not measured.

## M4 writes

Run installed CLI file/stdin and initialized MCP create/replace/append scenarios.
Assert exclusive create (including dangling symlinks), stale/deleted replacement
conflicts, missing append refusal, latest append under serialization across distinct
cache selections, exact parent/target spelling, mode preservation and symlink/hardlink
refusal. Verify managed adoption with deterministic UTC clock, supplied/omitted/null
metadata merge, comments and original custom scalar tokens, malformed/unsupported
YAML refusal, BOM and CRLF. Pin full before/after diff and versions.

Snapshot bytes, entry names, identities, mode, size and mtime/ctime across scratch
vault AND external cache parents before/after CLI and MCP dry-run, including absent
external caches. MCP startup must not eagerly create/bind/reconcile caches. Real
writes revalidate. Check 10 MiB input/result limits and JSON framing headroom.
Use controlled publication failures to verify temp cleanup and post-publication
success/version with degraded index/finalization errors. Verify a real live SQLite
mutation lock cannot be stolen and SIGKILL releases ownership without removing the
inode; no sleeps, probabilistic loops or real vault access. Crash temps may require
manual cleanup after writers stop. Mutation lock ends before index lock begins.
Record the remaining uncoordinated-editor check-to-publication race.

## M5 watch and recovery

Verify JSONL ready/sync/diagnostic/stopped/error envelopes and text mode, external
create/edit/delete/rename/alias updates, quiet unchanged scans and active MCP cache
commits without another tool request. Keep stdin open through event handshakes.
Use controlled attachment/dirty-during-scan/missed-event failures, bounded retry
exhaustion and late-attachment shutdown. Preserve M4 preview snapshots and write
success after activation failure. Test active EOF/signals/stdout closure, deleted,
corrupt and incompatible data recovery, inaccessible-note exclusion and recovery.
Pause a real staged rebuild before publish; prove live exclusion, kill/restart,
complete old/new data, stable coordinator inode and concurrent reader/rebuild.
Run the unchanged benchmark; no graph-heavy/mutation-throughput claim. Watch
notification reliability on network/virtual filesystems remains platform-limited.


## M6 package and release evidence

Run the unchanged acceptance gate with optional MDWIKI_ARTIFACT_DIR pointing to an
owned directory outside the repo. After installed tests pass it retains the tested
tarball and artifact.json (SHA-256 and npm file manifest). Check the compiled binary,
MIT license, shipped operational/spec docs, runnable examples and exclusion allowlist.
The workflow tests execute shipped CLI and initialized Node-only MCP examples with
the selected binary. DEPENDENCIES.json is checked against all lockfile package
versions/licenses, including development-only dependencies. See docs/ACCEPTANCE.md
for row-by-row observable evidence and docs/RELEASE.md for the platform/release gate.
Run npm ci, acceptance, then the unchanged benchmark serially under owned workspace
TMPDIR/npm cache/config/prefix. Retain machine/filesystem and comparison limits.
Read-only npm naming/auth checks must not read credential files or print tokens;
404 is not claimability. Do not publish, tag or infer macOS success from Linux.
