# mdwiki v0.1

Approved direction: nine grill rounds, confirmed 2026-11-02. This is the canonical
product spec; docs/PLAN.md holds milestone execution state.

## Problem statement

People and agents need bounded, structured access to an existing Markdown vault
without moving its contents into an application database or replacing Obsidian.
Reading the entire vault wastes context; ad hoc writes risk losing concurrent
edits and damaging metadata. The owner also wants deliberate practice in
TypeScript application design, agent implementation, independent review, and
testing. mdwiki is intentionally separate from the existing Go project mdkb.

## Solution

Install one npm package providing `mdwiki` on Node.js LTS, macOS and Linux.
Initialize an existing Markdown folder, then list, read, search, follow backlinks,
and write notes through CLI commands or the same operations over stdio MCP.
The Markdown files remain authoritative and usable by any editor. SQLite FTS5
and link indexes are disposable caches. No accounts, network service, telemetry,
embeddings, or language model are needed for v0.1.

## User stories

1. As a vault owner, I initialize an existing folder without rewriting or moving
   notes, then discover that vault from a nested working directory.
2. As a CLI user, I list and browse a tree with bounded results and read each
   listed note by its exact relative path, including nested and Unicode names.
3. As an agent, I initialize a real MCP session and use structured tools, errors,
   pagination and content versions without parsing terminal text.
4. As a searcher, I find words/quoted phrases in titles, paths, body or custom
   metadata, optionally filtering exact frontmatter tags, with useful excerpts.
5. As an editor user, I change/create/delete files outside mdwiki and see current
   results after a CLI sync or watcher reconciliation, without a full reindex.
6. As a writer, I create a new note without overwriting an existing path, replace
   only the version I read, or append to the latest contents without losing a
   cooperating mdwiki writer's changes.
7. As a vault owner, the first mdwiki write adopts standard metadata while
   preserving my custom YAML, comments, Markdown body and line endings.
8. As a cautious caller, I preview a complete proposed write diff without changing
   notes, creating cache files, or updating the index.
9. As a reader, I follow resolved backlinks while ambiguous/missing targets are
   reported explicitly rather than guessed.
10. As an operator, I rebuild a missing/corrupt/incompatible cache solely from
    files and receive per-file diagnostics for unreadable or malformed notes.
11. As a reviewer, I reproduce all acceptance evidence from a clean clone and
    installed package on macOS/Linux, entirely within disposable data.

## Implementation decisions

### Architecture and ownership

One strict-TypeScript package, compiled JavaScript for npm, with thin CLI and MCP
adapters over shared application operations. Core owns vault paths, discovery,
file access, parsing and mutation rules. Index code owns SQLite and schema.
Application operations coordinate synchronization, mutation, indexing and results.
No transport may reimplement path or conflict policies. Prefer simple modules
over an internal package monorepo, generic repository layer or plugin framework.

Node LTS is a prerequisite, with the exact supported line pinned at M0 and tested
on both platforms. npm lockfile required. Use the official stable MCP SDK plus
its compatible schema validator; a YAML document parser is justified by preserving
comments/custom values. A Markdown parser is justified if needed to distinguish
links from code reliably. SQLite must expose FTS5; prefer the supported built-in
Node API if verified, otherwise justify a maintained driver. Watcher dependencies
must earn their place through portable recovery behavior. Record dependency
choices and licenses in development docs; no runtime dependency on global CLIs.

### Vault selection, initialization and boundaries

One vault per CLI invocation or MCP process. Explicit `--vault <directory>` wins;
otherwise walk upward from cwd to the nearest `.mdwiki/config.json` marker.
Do not silently choose a home-directory vault. `init --vault <directory>` requires
an existing directory and creates only mdwiki metadata/cache, never note changes.
Repeated init is idempotent and must not silently change an existing cache location.

Default index directory: `<vault>/.mdwiki`. `--index-dir <directory>` overrides
the persisted init choice; an external index directory is supported. The marker
remains in `.mdwiki` for discovery. Resolve a relative override against cwd when
supplied and persist its canonical absolute path at init. Exclude the active cache
directory from scans even if explicitly placed in an otherwise visible subtree.
Cache locations are vault-bound: detect and refuse accidental reuse by a different
vault rather than contaminating results. Never recursively erase a supplied folder.

Init writes a local `.mdwiki/.gitignore` excluding mdwiki cache/config artifacts
from Git; documentation explains how to exclude `.mdwiki` from sync tools. Do not
silently modify Obsidian settings or claim that Git ignore controls Obsidian sync.

Notes are regular UTF-8 files with `.md` extension (case-insensitive extension
matching). Hidden path components, symbolic links, attachments and non-Markdown
files are excluded. Read and write accept exact forward-slash vault-relative paths
including the extension; reject absolute paths, `..`, empty/dot segments, backslash
separators and hidden components. Validate every parent and final target and apply
the same policy to listed/readable paths. Canonicalize the selected root once so a
normal macOS temporary-directory ancestor symlink is not confused with a symlink
inside the vault. Symlinked entries inside the root are never followed. Treat
hard-linked note writes conservatively: refuse multiple-link targets rather than
editing a file with uncertain ownership. Recheck relevant path state before publish.

Keep physical spelling for paths; never collapse two Linux files merely because
their case or Unicode normalization differs. Detect platform collisions rather
than guessing a write target. Preserve permissions on replacement and do not
change unrelated files or follow cache/config symlinks.

### File model and frontmatter

A note has path, title, raw content, content version, parsed metadata and diagnostics.
The content version is SHA-256 of the exact raw bytes, not normalized text or mtime.
Reads return the full original text. Missing metadata is allowed for reads/indexing.

On create, replacement or append, adopt the managed fields:
- `title`: nonempty string; preserve an existing valid value. If missing, use the
  first Markdown heading, then the filename stem.
- `created`: preserve an existing valid ISO calendar date or ISO timestamp; when
  missing, use current UTC adoption time, not a guessed filesystem creation date.
- `updated`: current UTC timestamp of this mdwiki write. External edits/indexing
  do not rewrite it.
- `tags`: sequence of strings; when missing use `[]`. Invalid existing managed
  types cause a diagnostic and refuse writes instead of silently discarding data.

Use an injectable clock for deterministic behavior tests. Timestamps are not note
identity. No UUID. Preserve valid metadata unless the caller explicitly replaces
the corresponding value; keep original `created` unless explicitly supplied in
replacement frontmatter. Replacement content omitted custom metadata must not
silently delete existing fields: merge supplied frontmatter fields into the current
document and replace the body. Explicit null for a custom field is a value, not an
implicit deletion API. Append input is literal body text, not metadata input.

Preserve custom field values, comments, and untouched YAML text where feasible;
edits must not lose comments or reinterpret values. Preserve existing newline style
and BOM. Limit supported frontmatter to a single YAML mapping with string keys and
safe bounded values; reject duplicate keys, unknown custom tags, alias expansion
cycles/excess and malformed or unsupported documents on writes. Use bounded parser
limits. Reads expose diagnostics and index the raw text when YAML cannot be parsed.
No bulk adoption, YAML cleanup, schema migration or body reformatting during reads.

Parse YAML 1.2 core scalars: strings, booleans, null, finite numbers and integers;
date/timestamp-like plain scalars remain strings, never JavaScript Date objects.
Retain original scalar source tokens for untouched custom values, including large
integers beyond JavaScript's safe range; never round them through a Number on write.
Index scalar lexical values as text (null contributes no text), with sequence order
and mapping-key order deterministic. NaN/infinity, non-string keys, explicit custom
tags, duplicate keys, cycles and expansion over limits produce diagnostics and block
write; raw-text search fallback remains available. Bound nesting to 50 and alias
expansion to 100 references per note. Tests must include large integers, booleans,
null, quoted numeric strings and date-like scalars without changing their meaning.

### Mutation semantics

MCP write tools are enabled by default. Normal writes do not prompt. Create refuses
existing targets, including dangling symlinks. Existing-note replacement requires
`expected_version`; missing or stale versions fail before mutation. A supplied
version always means replacement: if the target was deleted, fail with conflict,
never recreate it. Without a version, `write` is exclusive creation and conflicts
if the target exists. Append reads
latest contents inside the mdwiki write lock, inserts a newline boundary if needed,
and does not require a version. Append to a missing path fails; creation is explicit.
Create may make validated visible parent directories; dry-run may not create them.

Publish through same-directory temporary files and atomic replacement, with exclusive
publication for create. Serialize cooperating mdwiki mutations across processes;
avoid stale lock leaks after crashes and never steal a demonstrably live lock.
Keep lock ownership independent of optional index location so two processes with
different cache settings still coordinate writes. Reconcile the index after success.
If the file write succeeded but indexing failed, report that distinction, including
the new version, so a caller does not blindly retry an append.

Atomic publication is not an atomic compare-and-swap with external editors. Recheck
content/version as close to publish as possible; document the remaining race window
with Obsidian or another editor that does not honor mdwiki's lock. Never claim zero
lost-update risk against arbitrary uncoordinated external writes.

Dry-run executes validation and returns the proposed full diff and current/proposed
versions without note/cache/config/lock mutations; it is a preview, not a reservation.
The later real write must validate again. Git commits and backups are external.

### Index and synchronization

Schema-versioned SQLite cache stores vault identity, notes/metadata/content versions,
FTS documents, link occurrences/resolutions and diagnostics. Schema/index content
is rebuilt entirely from files; never restore a note from the database. Do not expose
raw SQL as a public API. Parameterize data and compile user queries safely.

Incremental reconciliation adds/updates/removes changed notes and link resolutions
transactionally. Content hashes decide changes; timestamp-only shortcuts must not
miss same-size edits or restored mtimes. Avoid reparsing/reindexing unchanged content.
Graph resolution may change when any path/alias is added/removed/renamed, even when
the source text is unchanged. Readers must not see a half-applied batch.

CLI index-backed reads reconcile first. MCP reconciles at startup, watches, and must
not knowingly serve a dirty index: await queued reconciliation before indexed reads.
MCP and `watch` monitor create/change/delete/rename events with debounce, startup
race handling, periodic reconciliation for missed events, and recovery diagnostics.
No OS service installation. Graceful SIGINT/SIGTERM/stdio closure releases resources.
Failures are visible and retries bounded; watcher errors cannot silently freeze data.

`reindex` incrementally reconciles; `reindex --full` rebuilds. Missing cache rebuilds
automatically. Corrupt or incompatible cache errors name the location and full-rebuild
command; that command must recover safely with multiple processes and WAL files.
Never publish an empty/partial cache as a successful rebuild if discovery failed.
Unreadable files should not retain stale content as if current: exclude affected
content from results, retain diagnostics, and distinguish missing from unreadable.

### Search

SQLite FTS5 over title, relative path, body, and all safe scalar frontmatter values,
including nested values; do not index metadata keys as user data. Flatten bounded
acyclic values deterministically. Invalid YAML falls back to raw text plus diagnostics.
Queries accept words and double-quoted phrases, all clauses ANDed by default. Punctuation
is text/token separation, never FTS operators or SQL; unmatched quotes and a query
with no searchable terms return actionable validation errors. Title matches receive
greater weight; rank ties sort by exact path. No raw FTS syntax or semantic search.

Optional repeated exact tag filters match all requested tags; tags are case-sensitive,
not inferred from inline `#text`. Each hit includes path, title and a useful bounded
excerpt from the matching field, including path or metadata matches. Returned scores
are ranking hints, not stable cross-version similarity measures.

### Wikilinks and backlinks

Parse `[[Note]]`, `[[Note|label]]`, `[[Note#Heading]]`, block fragments and `![[Note]]`.
Resolve fragments to notes without validating headings/blocks. A same-note fragment
resolves to its source. Ignore code spans/fences and HTML comments; exclude attachment
embeds. Standard Markdown links and unlinked mentions are later work.

Resolve in order: exact source-directory-relative target; exact vault-root target;
globally unique filename/stem; unique frontmatter alias. An explicit `.md` suffix is
optional for wikilinks. Ambiguity at a stage is reported with candidate paths, never
arbitrarily resolved. Invalid/traversing/hidden targets cannot escape vault boundaries.
`aliases` may be a string or string sequence for read compatibility; no alias rewriting.
Preserve physical case/spelling; document exact matching instead of asserting full
Obsidian parity. Backlinks contain source path plus bounded occurrence context, and
pagination. Missing/ambiguous links appear as structured link diagnostics.

### CLI and MCP contracts

Public command family (one package, one binary):

```text
mdwiki init --vault DIR [--index-dir DIR]
mdwiki [--vault DIR] [--index-dir DIR] list [--limit N] [--cursor TOKEN]
mdwiki [--vault DIR] tree [--depth N] [--limit N]
mdwiki [--vault DIR] read PATH
mdwiki [--vault DIR] search QUERY [--tag TAG] [--limit N] [--cursor TOKEN]
mdwiki [--vault DIR] backlinks PATH [--limit N] [--cursor TOKEN]
mdwiki [--vault DIR] write PATH --file FILE_OR_DASH [--expected-version HASH] [--dry-run]
mdwiki [--vault DIR] append PATH --file FILE_OR_DASH [--dry-run]
mdwiki [--vault DIR] reindex [--full]
mdwiki [--vault DIR] watch
mdwiki [--vault DIR] mcp
```

`write` without a version is exclusive creation; with a version it is replacement
and refuses a missing target as a conflict. Never infer creation from absence when
the caller supplied a replacement version.
Input via file/stdin avoids shell escaping and argument size limits. Support
`--json` on every ordinary command, including help/version, with human text default.
Global options work before or after subcommands. MCP owns stdout protocol and
rejects `--json` as redundant; `watch --json` emits JSON Lines events. Every event
contains `schema_version: 1`, `event`, a process-local monotonically increasing
`sequence`, UTC `timestamp`, `data`, `diagnostics`, and `degraded`. Event kinds:
`ready` after initial reconciliation and watcher attachment (data includes canonical
vault and index generation); `sync` after a committed change batch (generation and
added, changed, removed counts); `diagnostic` for recoverable failures (stable
code/message and retry intent); `stopped` on orderly shutdown (reason). Quiet
unchanged scans emit nothing. A fatal startup/runtime failure emits `error` with
code/message, cleans up and exits 5. A signal-triggered orderly stop exits 0 after
`stopped`. If stdout closes, stop without further events or a stack trace.
JSONL stdout contains only these events; human diagnostics remain on stderr.
No startup logs on stdout for MCP. MCP tools are `mdwiki_list`, `mdwiki_tree`,
`mdwiki_read`, `mdwiki_search`, `mdwiki_backlinks`, `mdwiki_write`, `mdwiki_append`,
`mdwiki_reindex`. No duplicate aliases in v0.1. Tools use the process-selected
vault, never accept an arbitrary alternate filesystem root per call.

Define and test common JSON envelopes with `schema_version`, `ok`, typed `data`
or `error` (`code`, `message`, optional details), `diagnostics`, and degraded state.
MCP returns structured results using the same data/error contract plus readable
text, and marks tool errors appropriately. Transport/schema errors remain MCP errors.
Operational error codes are stable names; no internal stack traces by default.
CLI exit codes: 0 success; 2 usage/validation; 3 not found; 4 conflict; 5 operational
failure; 6 usable but degraded/incomplete result. Output error JSON to stdout under
`--json`; human diagnostics to stderr. Broken stdout pipe exits without a stack trace.

Default page size 50, maximum 200. Deterministic ordering; opaque cursors bind query,
vault and index generation, and reject stale/mismatched cursors rather than silently
skip results. Direct listings may use a file-list generation digest. Tree defaults
to depth 3 and at most 200 entries, with explicit truncation metadata. Validate all
limits, cursor types, input sizes and paths at the public boundary. Read returns a
whole note or an explicit size error, never silent truncation; use a documented
10 MiB default note/body limit and bound protocol/query sizes compatibly.

## Testing decisions

The highest shared seam is a real installed CLI process and real initialized stdio
MCP session operating on disposable vaults. Core integration tests support focused
failure reproduction, but cannot substitute for protocol/package tests. Keep child
stdin open until expected responses arrive and enforce timeouts/cleanup.

`bash scripts/accept.sh` runs typecheck, lint, build, unit/integration tests, package
packing/isolated install and CLI/MCP end-to-end scenarios. CI executes the same gate
on macOS/Linux. Tests never overwrite HOME or use personal notes; pass explicit
scratch vault/cache paths and npm prefixes. Avoid network runtime tests, hidden
global state, unchecked child exits, fixed sleeps as correctness proof, and tests
that merely assert implementation details or documentation status sentences.

Required observable coverage includes:
- initialization idempotency, discovery, external index, bounds, pagination;
- list/read parity, Unicode/case, traversal/hidden paths/symlinks/hardlinks;
- search phrases/punctuation, frontmatter nesting, tags, excerpt and stable ties;
- external changes/removal, restored mtime edits, graph target/alias changes;
- duplicate filenames/aliases, fragments/embeds, code/comments and ambiguity;
- YAML comments/custom fields, CRLF/BOM, malformed/unsupported input, adoption;
- dry-run no side effects, version conflicts, exclusive create, latest append;
- two real processes writing/indexing, failure after file publish, killed process;
- watcher startup/missed-event recovery and shutdown, cache deletion/corruption;
- MCP malformed input, unknown tool, wrong argument types, concurrent calls;
- install tarball in a clean prefix and run documented examples using that binary.

Generate a 10,000-note benchmark under 100 MiB, record machine/Node/fixture details,
cold index, unchanged sync, search latency and memory. Establish budgets from an
early M2 baseline, then rerun in M6 and investigate regressions. Do not invent
measurements or turn CI timing noise into a false guarantee.

## Out of scope

Semantic/hybrid retrieval, embeddings, local ask, TUI, web/Tauri, daily/task extraction,
inline tags, tag-management commands, Git-aware history, link repair/orphan commands,
graph export, cross-vault search, automatic imports, symlink traversal, hidden-note
support, Windows, required accounts and telemetry. No wholesale Rust crate layout
transplanted into TypeScript. No automatic vault migration or external-editor locks.

## Open questions

No blocking product decisions remain. M0 verifies dependency/runtime compatibility;
M2 measures initial performance budgets. Registry naming/credentials are checked
before publication: an npm 404 for a previously unpublished `mdwiki` package does
not prove the name is claimable. Keep binary name `mdwiki`; do not claim publication
without registry evidence. These do not block implementation or tarball installation.

## Further notes

One milestone per issue/branch/draft PR/T3 worktree thread. M0 lands alone. GPT-6.1
Sol medium workers implement; Astra integrates, reruns acceptance, and triages
independent standards/spec and attack reports. Full review uses the branch diff,
not only its final commit. Both CI platforms must pass before merge. Fix surviving
bugs with regression evidence and preserve review lessons in the central worklog.
Use a release skeptic on each platform before tagging. No waiting for routine
permission between milestones; pause only for a genuinely unresolved product choice
or unavailable required capability. User confirmation of the grill and instruction
to run spec/tickets/build authorize this sequence without another approval round.
