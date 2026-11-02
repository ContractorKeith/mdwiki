# Development

M0 (#8) and M1 (#11) are merged. M2 is merged in PR #15; M3 is merged in PR #16, not published. Node 26.13.0 and npm
11.20.0 were used on Linux x86_64. The supported Node line is >=26.13.0 <27,
enforced by package engines and the acceptance script; .nvmrc pins CI to 26.13.0.

## Gate and commands

Run `npm ci`, then `bash scripts/accept.sh`. The latter runs, in order:

1. `npm run typecheck`: strict TypeScript, including dependency declarations.
2. `npm run lint`: ESLint over source, tests and scripts.
3. `npm run build`: compiled ESM JavaScript in dist, including the executable.
4. `npm test`: CLI/MCP subprocess scenarios and SQLite integration tests.
5. `npm run test:installed`: npm pack, isolated global-prefix install, then the
   same scenarios through the executable in prefix/bin and the installed schema module.

Ordinary `npm pack` runs the prepack build hook, so a clean source checkout cannot
silently produce a tarball without the executable. The gate's pack runner uses
`--ignore-scripts` only after its explicit build; a separate regression test packs
an unbuilt source copy with lifecycle scripts enabled.

The installed test uses explicit temporary npm prefix, cache, user config and
global config paths, ignores lifecycle scripts, and removes only its own temporary
directory in a finally block. Registry access is required for dependency install;
application runtime tests do not use the network. No HOME/CODEX_HOME changes.

The GitHub Actions matrix runs `npm ci` and precisely `bash scripts/accept.sh`
on ubuntu-latest and macos-latest, with no platform skips. Local Linux results
cannot substitute for a completed green macOS job; the orchestrator verifies both
before merge. M0 does not supply release or benchmark evidence.

## Runtime choices and direct dependencies

Versions are exact in package.json and transitive resolutions/integrities are in
package-lock.json. No global CLI, native addon, ORM or framework is needed.

| Dependency | Version | License | Concrete benefit |
|---|---|---|---|
| Node.js | 26.13.0 | MIT with bundled third-party notices | Current LTS, built-in test runner and SQLite avoid extra runtime/build dependencies |
| @modelcontextprotocol/server | 2.4.0 | Apache-2.0 | Official stable v2 SDK owns protocol framing, negotiation, schema validation and stdio lifecycle |
| zod | 4.6.7 | MIT | Pins the SDK's compatible Zod 4 validator (SDK requires ^4.2.0), rather than a separate validation mechanism |
| yaml | 2.9.1 | ISC | YAML 1.2 document parser retains comments/source tokens and supports bounded safe metadata validation without rewriting notes |
| mdast-util-from-markdown | 2.1.0 | MIT | CommonMark syntax positions distinguish inline, fenced, indented and nested code plus HTML comments from wikilinks; original source spelling and offsets remain authoritative |
| typescript | 6.0.3 | Apache-2.0 | Strict static checking and portable compiled JavaScript |
| @types/node | 26.6.6 | MIT | Node 26 API declarations, including node:sqlite |
| eslint | 10.14.0 | MIT | Static checks for source and the runnable test/gate scripts |
| @eslint/js | 10.0.1 | MIT | Official recommended JavaScript lint rules |
| typescript-eslint | 8.72.1 | MIT | TypeScript parser/rules integrated with the same lint command |

TypeScript 7.0.2 is newer but outside typescript-eslint 8.72.1's supported
`>=4.8.4 <6.1.0` peer range. TypeScript 6.0.3 installs without peer bypasses.
SDK 2.4.0 requires Node >=20 and depends on Zod ^4.2.0; the pinned runtime and
validator satisfy those requirements. No prerelease dependency is selected.

Verification sources (checked 2026-11-02):
[Node release status](https://nodejs.org/en/about/previous-releases),
[official stable SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/),
and published npm metadata (`npm view PACKAGE@VERSION engines dependencies license`).

Node's [SQLite API](https://nodejs.org/docs/latest-v26.x/api/sqlite.html) is
supported without a flag but still has stability 1.2 (release candidate).
We use its small synchronous DatabaseSync API for the private M0 seam as the spec
prefers the built-in API. This avoids native-addon installation and ABI coupling;
the acceptance tests prove FTS5 with an actual virtual table, parameterized insert,
MATCH, persistence and reopen on each tested platform. Do not describe the Node
SQLite API itself as stable. Later indexing performance is an M2 concern.

At implementation time, `npm audit --omit=dev` reports zero vulnerabilities.
The full audit reports 11 moderate findings through development-only minimatch
(<11.0.1; GHSA-g3hv-75wg-m249). These affect lint tooling, not the installed
runtime. No unsupported major override or forced peer bypass is applied.

## Current seams and limits

src/core owns initialization/discovery, cache binding, exact path policy, bounded
file reads and YAML parsing. src/operations.ts owns shared input schemas and
application calls. CLI and MCP only select a vault and translate arguments/results.
The active cache is bound by vault.json; the discovery marker persists its default
location. Both contain schema_version 1 and canonical vault/index_dir paths.
Changing an initialized marker's vault binding or reusing a bound cache conflicts.
Metadata symlinks are refused; the selected root is canonicalized, including normal
macOS temporary-directory ancestors. macOS system /var and /tmp ancestors of cache
paths are canonicalized, without accepting symlinked cache entries.

List cursors bind canonical vault, filesystem generation, page size and offset.
The M1 generation hashes sorted physical paths, sizes, nanosecond mtime/ctime and
folder paths; it is a filesystem observation, not an indexed snapshot. Directory
chains are checked before/after enumeration and after descent, including physical
identity checks for previously observed directories. Detected replacements refuse
the scan rather than returning entries from excluded locations. These checks are
not atomic exclusion against arbitrary concurrent external editors. Traversal
failures fail the operation instead of publishing a partial success. Ordering uses
exact JavaScript string comparison, without case folding or Unicode normalization.
Tree depth is 1–50, entries 1–200; depth 1 is root entries. List is 1–200 (default 50).
Read paths are at most 4096 characters, cursors 2048. Reads are at most 10 MiB,
including BOM, and decoding rejects invalid UTF-8. File handles use O_NOFOLLOW and
check identity/path state around reads. Concurrent external changes can require a
retry; these filesystem observations do not provide a transaction with editors.

Frontmatter is a YAML 1.2 core mapping, bounded to depth 50, 100 expanded alias
references and 100,000 visited values. Unsupported tags/types, duplicate/non-string
keys, cycles and nonfinite numbers yield INVALID_FRONTMATTER diagnostics; invalid
managed fields yield INVALID_METADATA. Failed parsing exposes empty metadata and
retains the raw content. Missing frontmatter needs no diagnostic. JSON metadata
uses strings for integers outside the safe Number range, preserving scalar source
spelling; date-like scalars remain strings. yaml document/source tokens preserve
comments and lexical types for later writes; reads perform no adoption or mutation.

Stable application errors: VALIDATION_ERROR, UNSAFE_PATH, INVALID_UTF8 and
SIZE_LIMIT exit 2; NOT_FOUND exits 3; CONFLICT exits 4; CONFIG_ERROR and
OPERATIONAL_ERROR exit 5. Successful diagnostic-bearing reads and truncated trees
exit 6. Error envelopes never include internal stack traces or raw filesystem errors.

src/mcp.ts delegates stdio to the SDK. The precise published tool schemas are also
validated at the shared application seam, allowing valid tools/call envelopes with
invalid M1 arguments to return structured VALIDATION_ERROR results consistently.
Tests exercise initialize/initialized, exact tool names/schemas, real calls,
invalid argument and cursor types, unknown tools/methods, concurrent requests, EOF
and SIGINT/SIGTERM. Every stdout line must be protocol JSON; diagnostics use stderr.
Malformed protocol envelopes remain SDK-owned: scalar params may be diagnosed
without a response, and malformed protocol tools/list cursors may receive -32603.
Bounded callers must not wait indefinitely for a malformed-envelope reply. This is
distinct from validated mdwiki_list cursor arguments; no protocol fork is used.

src/index owns SQL and schema version 3. `index.sqlite` stores the canonical vault,
content generation, note hashes/metadata/diagnostics, exact tags, unreadable-file
diagnostics and FTS5 documents. Earlier M0/M2 schemas require an explicit full rebuild. Schema definitions, SQLite quick_check and FTS integrity are checked on
open. Every search and backlinks call reconciles first; unchanged bytes are read/hashed but neither
parsed nor replaced in FTS. A batch updates notes, tags, FTS, diagnostics and its
new opaque generation in one transaction. A failed directory traversal never
publishes a partial successful scan. File read failures exclude old content and
return degraded diagnostics; files disappearing mid-scan are distinct NOT_FOUND
diagnostics. Normal missing files are removed during the next complete scan.

All cooperating index access acquires `BEGIN IMMEDIATE`
on a separate persistent `coordinator.sqlite`, then opens the data DB. An in-process
queue prevents synchronous SQLite busy waits deadlocking concurrent MCP calls.
The five-second busy timeout is bounded: another long scan may require a retry.
Connections close before releasing the coordinator. SQLite releases ownership on
process death; there is no PID lock or stale-lock stealing. Keep the coordinator
inode stable: never unlink it while any process may be running.

`reindex --full` builds a uniquely named staging DB from a complete discovery,
checkpoints/closes it, removes only the old data DB's WAL/SHM/journal sidecars and
atomically renames the staging DB to `index.sqlite` under that coordinator lock.
It can replace corrupt/incompatible data even with other cooperating processes
waiting. Failures before publication retain the previous data DB. Startup/call
errors name the cache and the exact full-rebuild command. Unsafe cache symlinks,
hard links and directory entries are refused. Full rebuilding does not recursively
erase the index directory or touch notes. A crash can leave a `rebuild-*.sqlite`
staging artifact; after stopping all mdwiki processes, such artifacts can be removed.

The coordinator is operational coordination state, separate from disposable index
data. If it is itself externally corrupted, stop **all** processes using that cache,
remove only `coordinator.sqlite` and its `-journal`/`-wal`/`-shm` sidecars, then run
`reindex --full`. Never do this while another process can hold its inode. Direct
SQLite clients or external deletion/replacement of live cache files do not honor
this protocol. This does not supply a filesystem transaction with arbitrary editors.
M5 adds watcher recovery; M4 adds mutation coordination. M2 implements only the
coordination required for safe data-cache rebuilding.

Search compiles words/phrases into quoted ANDed FTS clauses; punctuation is text
separation. Titles have bm25 weight 8 versus 1 for other fields; ties sort by exact
SQLite BINARY path order. Safe scalar YAML source values are flattened in document
mapping/sequence order without keys; null contributes nothing. Invalid YAML uses
raw content. FTS chooses the matching excerpt field; excerpts are character bounded
around the match (at most 484 characters), including path/metadata-only hits. Scores
are ranking hints. Search cursors bind canonical vault, generation, exact query,
sorted/deduplicated exact tags and limit; malformed/stale/mismatched cursors fail.
Queries allow 4096 characters/128 clauses, tags 50 x 256 characters, page sizes
1–200 (default 50), cursors 2048 characters. No raw SQL interface is published.

Tests use temporary directories with tiny fixtures, outside real vaults. Each child
has an 8-second timeout and cleanup hook; the pack/install runner has bounded
120-second child commands and always removes its scratch directory. MCP stdin
stays open until all expected replies arrive. No fixed sleeps establish correctness.

M4 writes are merged in PR #17; M5 watching/recovery is implemented pending review;
M6 owns release evidence.

See [M2 benchmark](BENCHMARK.md) for the bounded 10k-note command and baseline.

## M3 graph and review evidence

Core `links.ts` uses mdast-util-from-markdown solely to mask code syntax and HTML
comments, then extracts wikilinks from original text. This dependency handles
CommonMark container nesting and variable backtick spans reliably; a second custom
Markdown block parser would duplicate complex grammar. Its runtime tree is pinned
in the lockfile; no renderer or unified plugin framework is added. A cheap no-`[[`
check avoids Markdown parsing when there can be no wikilinks. Frontmatter ranges
are excluded even when YAML is malformed; unterminated frontmatter excludes the
remaining document. Original YAML scalar types validate aliases before JSON's
lexical representation of large integers can produce false string aliases.

Schema v3 stores validated aliases and ordered occurrence JSON, resolved note paths
and bounded resolution diagnostics. Changed source bytes replace their occurrences;
any committed batch change rebuilds path/name/alias lookup maps and re-resolves
stored occurrences, including unchanged sources, in the same SQL transaction as
FTS/notes/generation. Unchanged scans do not parse or update graph rows. Target
read failures remove it from resolution; source read failures remove its occurrences.
The M2 coordinator, staged full rebuild and failure rollback guarantees remain.
A v2 cache yields an actionable `reindex --full` error; no in-place schema migration
or note rewriting occurs. See README for exact resolution and page contracts.

M3 merged in PR #16 after parent standards/spec review and macOS/Linux CI passed. Evidence
uses ordinary inspection and deterministic disposable tests, including real installed
CLI/initialized MCP parity, cursor bindings, YAML/code lookalikes, duplicates,
Unicode/case, target/alias edits and rename/removal, rollback and old-schema recovery.
M3 introduced no watcher or write tools. The existing benchmark fixture is unchanged
and has no wikilinks, so its comparison measures graph integration overhead rather
than graph-heavy parsing/resolution throughput.

## M4 mutation behavior

Core `mutations.ts` owns validated create/replace/latest append, path observations,
same-directory publication and the injectable clock. `adoption.ts` merges YAML
nodes rather than public JSON metadata. The serializer retains original single-line
scalar source tokens, including quoted escapes and numeric lexical forms, while
preserving document comments and safe custom values. Resulting YAML is validated
again, so conflicting supplied anchors/aliases cannot silently change meaning.
Body newlines follow the current note (or new input); existing BOM/mode survive.
No dependency was added. See README for commands, response/diff sizes and errors.

The shared SQLite transaction queue moved to core `coordinator.ts`; SQL for index
content/schema remains in index. Mutation coordination uses the initialized vault's
`.mdwiki/mutations.sqlite`, not the optional cache directory. Its stable inode and
SQLite transaction release avoid stale locks after a killed writer. Lock ordering
is mutation release, then index lock; no code holds both. An in-process queue avoids
blocking the event loop behind another async holder; cross-process busy timeout is
five seconds. Recovery of a corrupted mutation coordinator requires stopping all
writers first, then removing only that coordinator and its sidecars. Never steal
or unlink a live lock. A crash can leave an owned hidden note temp; normal errors
clean them. Arbitrary external directory replacement may prevent safe cleanup;
mdwiki refuses rather than following a swapped parent to delete an unrelated file.

CLI selection and MCP startup use read-only binding validation. Cache creation and
reconciliation are deferred to actual indexed operations; each indexed read still
reconciles first. This intentionally defers the earlier eager MCP startup sync to
make preview-only sessions side-effect-free, including vanished external caches.
M5 preserves that property with lazy watcher startup. A real write revalidates
and publishes before reconciliation. Post-publication indexing or finalization
errors preserve explicit file success and its version, with degraded diagnostics.
Never retry a published append just because cache work failed.

Ordinary deterministic regression fixtures cover byte/metadata preservation,
exclusive and stale/missing-target semantics, different-cache writer processes,
live lock ownership and killed-holder recovery, full filesystem preview snapshots,
large MCP framing, Unicode/byte limits, publication failure cleanup and separate
post-publication index failure over real CLI and initialized MCP. External editors
remain outside the protocol: path/content checks narrow but cannot eliminate the
last check-to-rename race. No atomic external compare-and-swap claim is made.
Linux results are local; macOS evidence requires the CI job. Watcher recovery and
graph-heavy performance workloads are not claimed by M4.

## M5 watch lifecycle (pending review)

`core/watch.ts` attaches built-in recursive filesystem notifications with exclusions
before descent on Node's recursive implementation. `watch.ts` owns the shared
application queue, debounce, attachment/scan race, periodic reconciliation and
bounded retries. `watch-cli.ts` translates lifecycle events and termination;
MCP injects the same index runner into application operations. Writes publish and
release the mutation lock before lazy activation. No dependency or schema change.
See README for exact event fields, timers, retry/restart and platform limits.

Every indexed operation still hashes all eligible files. This favors correctness
across processes and missed notifications; it does not claim lower search latency.
At most one background pass is queued; continuous edits can require repeated scans
before an indexed call can return without known dirty work. Shutdown closes timers
and notifications immediately and awaits in-flight bounded filesystem/index work.
The five-second coordinator wait still applies; shutdown is not cancellation of an
already executing SQLite statement or filesystem request.

The M5 fixture suite runs through source and installed package paths. Real CLI
watch events and real initialized MCP cache commits are observable handshakes;
controlled attachment/scan failures and short test-only scan intervals cover
missed events, dirty responses and bounded retries. A real rebuild is paused before
staging publication, excludes a reader, and is killed: old data stays complete,
the stable coordinator is reused, then concurrent reader/rebuild processes recover.
M4 cooperating append/live mutation holder and complete preview snapshots remain.
Do not delete live coordinators; externally corrupt coordinators still require all
processes to stop before the documented manual removal. Staging artifacts from a
killed rebuild remain for manual cleanup after processes stop. No external cache
directory is recursively erased. macOS evidence must come from actual CI.
