# mdwiki

Local-first knowledge base over ordinary Markdown files. mdwiki is intended to
complement an existing editor; files remain the source of truth.

Provides browsing, search, backlinks, metadata-preserving writes and watching through
one `mdwiki` executable and eight stdio MCP tools. No accounts or runtime network
service. v0.1.0 supports local tarball installation. See [release evidence](docs/RELEASE.md)
for verification and registry publishing constraints.

Requires Node.js **26.13.0** (supported line: >=26.13.0 <27) and npm.
Development uses npm 11.20.0. Install a locally produced artifact:

```sh
npm install --global /absolute/path/to/mdwiki-0.1.0.tgz
mdwiki --help
mdwiki --version --json
```

See [the disposable CLI workflow](docs/USAGE.md) for isolated installation without
a global prefix, every command family, and runnable examples shipped in the tarball.
[Agent instructions](docs/AGENTS.md) include initialized MCP requests, schemas and
safe write handling. [Acceptance mapping](docs/ACCEPTANCE.md),
[release checklist](docs/RELEASE.md) and [dependency inventory](docs/DEPENDENCIES.json)
record reproducible verification and remaining release constraints.

From a checkout, run `npm ci`, then `bash scripts/accept.sh`. The gate tests source
and a fresh installed tarball using synthetic vaults. See [development](docs/DEVELOPMENT.md).

Initialize an existing directory with `init --vault DIR`; notes are never rewritten.
Repeat init to reuse its persisted cache choice. For ordinary commands, `--vault`
wins; otherwise mdwiki finds the nearest initialized ancestor of the working
directory. Global flags work before or after commands. `--index-dir` overrides
the cache for an invocation without changing the persisted choice. A directory
cannot be reused as a cache for a different vault.

The discovery marker stays in `.mdwiki/config.json`. Its local `.gitignore`
excludes mdwiki artifacts from Git. Configure your sync tool separately to exclude
`.mdwiki`; Git ignore does not control Obsidian Sync or other sync services.

Lists contain exact relative paths, including extension. Spaces, Unicode and `.MD`
are supported. Hidden components, symlinks and attachments are excluded. Use
physical spelling, forward slashes, no absolute paths, dot segments or backslashes.
Reads return complete original text and SHA-256 of exact bytes, with metadata and
per-note diagnostics. Invalid YAML remains readable with degraded status; invalid
UTF-8 and notes over 10 MiB return explicit errors.

`list` defaults to 50 notes, maximum 200. Pass `next_cursor` back with the same
`--limit`; a changed vault generation requires restarting pagination. `tree`
defaults to depth 3 and at most 200 entries, returning explicit `truncated` state.
JSON tree entries are flat paths with `note` or `directory` type; depth 1 means
root entries. Truncation is a usable incomplete result (exit 6).

Search ANDs words and double-quoted phrases: `search 'design "local cache"'`.
Punctuation separates text; FTS operators are never executed. Search covers title,
path, body and nested metadata values, with title weighting, exact path tie order,
scores and excerpts of at most 484 characters. Repeat `--tag TAG` to require every
exact, case-sensitive frontmatter tag. Inline tags are not filters. Queries are
limited to 4096 characters and 128 clauses; at most 50 tags of 256 characters.
Search defaults to 50 results, maximum 200; reuse `next_cursor` with the same query,
filters and limit. A content change, failure change or full rebuild invalidates it.

`backlinks PATH` requires an exact visible note path including extension. Wikilinks
support labels, heading/block fragments, note embeds and same-note fragments.
Headings/blocks are not validated. Code spans, fenced/indented code, HTML comments,
frontmatter and attachment embeds (explicit non-Markdown extensions) are excluded.
Standard Markdown links are not indexed.

Resolution uses exact source-folder-relative path, then vault-root path, then
unique filename/stem, then unique frontmatter alias. The `.md` suffix is optional;
matching preserves case and Unicode spelling, including extension case when supplied.
An omitted extension considers all physical Markdown extension spellings, diagnosing
ambiguity. Aliases accept a YAML string or entirely string sequence; invalid alias
types are ignored. Unsafe targets are diagnosed before resolution. This is a defined
exact matcher, without full Obsidian compatibility.

Backlinks `data.entries` contains one `{path, occurrence}` per resolved occurrence.
`occurrence` includes target, fragment, embed, zero-based UTF-16 offset, one-based
line/column and at most 320 UTF-16 characters of original context. `data.link_diagnostics`
contains vault-wide unresolved occurrences with `MISSING_LINK`, `AMBIGUOUS_LINK` or
`INVALID_LINK`, candidate paths (first 200) and total `candidate_count`. Target text
is bounded to 4097 characters (overlength targets are invalid); fragments to 4096.
These are graph facts rather than operation failures and do not themselves set
`degraded`; unreadable/metadata diagnostics still do. Human output prints resolved
source paths and unresolved summaries to stderr; JSON/MCP carry full structure.

One page spans **both** arrays: at most `limit` total occurrences, default 50,
maximum 200, ordered by exact source path then occurrence order. A page may contain
only diagnostics. Continue `next_cursor` until null for the complete result; reuse
the same target/vault/limit. Any committed index change or full rebuild invalidates
cursors. Target or alias changes re-resolve unchanged sources without reparsing them.

`write PATH --file FILE_OR_DASH` creates exclusively; supply `--expected-version HASH`
from `read` to replace an existing note. A missing replacement target conflicts and
is never recreated. `append PATH --file FILE_OR_DASH` reads the latest existing
note under the vault's mutation lock; it adds a newline boundary when needed.
`--file -` reads stdin. Both commands accept `--dry-run`, `--json`, `--vault` and
`--index-dir`, without prompts.

The complete runnable create, preview, read-version, replace, stale-conflict and
append sequence is in [the disposable workflow](docs/USAGE.md).

Writes adopt `title`, UTC `created`/`updated` and `tags: []` when missing, retaining
valid existing title/created/tags unless replacement YAML explicitly supplies them.
`updated` is always this write's UTC time. Replacement merges supplied top-level
YAML fields and replaces the body; omitted custom fields survive and custom null
is a value. Append treats all input as literal body text, including YAML delimiters.
Malformed/unsupported YAML or invalid managed values refuse writes. Custom values,
comments and scalar spellings (including large integers) survive; YAML collection
formatting may be normalized. Existing BOM, newline style and permissions survive.
Symlinks and multi-link targets are refused. Visible missing create parents are
validated before creation; note paths require exact physical spelling.

Dry-run returns `diff: {before, after}` containing the entire old/proposed text,
`current_version` (null for create), `proposed_version` and `file_written: false`.
This full replacement diff includes adoption; no truncation or external diff tool
is used. Preview creates no notes/directories/cache/config/locks, even when the
selected external cache is missing. It reserves nothing; a real write validates
again. Each input and final note is limited to **10 MiB UTF-8**, including YAML/BOM.
Metadata adoption can put an otherwise valid input over the resulting-note limit.
Before/after total at most 20 MiB; JSON escaping can expand each byte sixfold.
MCP accepts a bounded `6 × 10 MiB + 64 KiB` incoming frame (send large calls one at
a time); structured plus readable-text preview results can occupy up to 264 MiB
including envelope headroom in the worst JSON-escaping case. Clients must allow full responses of that size.

Real results include `file_written: true`, `content_version` (also
`proposed_version`) and separate `index: {ok, data|error}`. If reconciliation fails
after publication, the envelope stays successful with `degraded: true`, diagnostic
`INDEX_UPDATE_FAILED` and CLI exit 6. The new version proves publication: **do not
retry append**; repair/reconcile the cache. A post-publication cleanup/finalization
failure similarly reports `PUBLICATION_CLEANUP_FAILED` without denying file success.

Cooperating writers serialize via `<vault>/.mdwiki/mutations.sqlite`, independently
of cache overrides, then release that lock before index coordination. SQLite
releases locks after process death; no PID/stale-lock stealing is used. Never
remove/replace a live coordinator or its sidecars. Publication uses a synced,
same-directory hidden temp followed by atomic rename for replacement or exclusive
hard-link publication for create. Normal failures clean owned temps. A killed
process can leave `.mdwiki-write-*.tmp`; after stopping writers, remove only such
owned artifacts. Parent identity/content/mode/link checks immediately precede
publication. External editors do not honor this lock: an edit in the final
check-to-publication window can still be overwritten. This is not atomic
compare-and-swap with Obsidian or arbitrary filesystem changes.

`reindex` reconciles additions, edits and removals. Every indexed call rereads and
hashes eligible bytes; unchanged content skips parsing and FTS replacement. Search
and backlinks reconcile each call. MCP defers cache creation, reconciliation
and watcher attachment until its first indexed operation or successful real write,
so initialize/list/tree/read/preview-only sessions have no filesystem side effects.
Invalid YAML uses raw-text search with diagnostics. Unreadable notes are excluded
from current hits with diagnostics; traversal failures fail the operation.

The vault-bound cache is disposable. Missing `index.sqlite` builds automatically;
CLI corrupt/incompatible data errors name `reindex --full` with the same vault/index-dir.
An active watcher diagnoses these failures and retries with a coordinated full rebuild.
Full rebuild stages a complete database, then replaces only cache artifacts while
holding a persistent SQLite coordinator transaction. Cooperating processes wait
up to five seconds, then return an actionable retry error. Never delete the
coordinator or cache directory while mdwiki is running; see the recovery details
in [development notes](docs/DEVELOPMENT.md). Notes are never modified by indexing.

Watch external edits with `mdwiki --vault DIR watch` or `watch --json`. Keep stdin
open; EOF, SIGINT and SIGTERM stop it cleanly (exit 0). An unattended launcher must
provide an open input stream. This is a foreground process, not an installed service.

JSON mode writes one event per line, with exactly `schema_version: 1`, `event`,
`sequence` (increasing per process), UTC `timestamp`, `data`, `diagnostics` and
`degraded`. Text mode prints readable event names/data and diagnostics on stderr.

| Event | Data and meaning |
|---|---|
| `ready` | Canonical `vault` and `generation`, after attachment and initial sync |
| `sync` | `generation`, `added`, `changed`, `removed`, after a committed changed batch |
| `diagnostic` | Stable `code`, actionable `message`, `retry: true`; operational retries also include `attempt` and `retry_ms` |
| `stopped` | `reason` on orderly shutdown |
| `error` | Stable `code` and `message`; fatal failure cleans resources and exits 5 |

Unchanged scans emit nothing. Notifications are debounced for 75 ms; every five
seconds a full read/hash reconciliation also catches missed events and retries
unreadable notes. Unchanged note bytes skip parsing/FTS updates. Attachment precedes
the first scan; notifications during scanning trigger another pass. Indexed MCP
calls await the queue and any known dirty work before responding. Each indexed
call still reconciles, including when another process changed the shared cache;
M5 does not claim a reduced per-call hashing cost.

The implementation uses Node's built-in watcher on macOS/Linux, excluding hidden
paths, symlink entries and the active cache. Notifications can be coalesced or lost,
and network/virtual filesystems may not support watching reliably. The periodic
fallback improves eventual recovery; it cannot provide an atomic filesystem
snapshot with external editors. OS watcher/access failures are visible and trigger
reattachment. Operational failures retry after 250/500 ms and stop after three
consecutive failures; then restart after fixing access/OS limits. An MCP process
keeps direct reads available but rejects indexed calls after fatal watch failure;
restart it to reactivate watching. Unreadable-note diagnostics remain degraded,
exclude stale results and retry at the normal scan interval; repeated identical
diagnostics do not flood output. Cache corruption/incompatibility is diagnosed
before a coordinated staged rebuild; unsafe cache paths are never overwritten.
A published write remains successful even if activation/reconciliation fails.
Stdout pipe closure stops without further events or a stack trace. MCP writes only
protocol messages to stdout and reports watch diagnostics on stderr.

MCP clients launch the installed binary with `--vault DIR mcp`. Initialize the
vault through CLI first. The tools are exactly `mdwiki_list`, `mdwiki_tree`,
`mdwiki_read`, `mdwiki_search`, `mdwiki_backlinks`, `mdwiki_write`, `mdwiki_append`
and `mdwiki_reindex`. Arguments mirror command
options: read takes `path`; search takes `query`, optional `tags` (array), `limit`
and `cursor`; backlinks takes exact `path`, optional `limit` and `cursor`; reindex takes optional boolean `full`.
Write takes `path`, `content`, optional SHA-256 `expected_version` and boolean
`dry_run`; append takes `path`, literal `content` and optional `dry_run`.
They share CLI JSON envelopes in `structuredContent`, plus readable JSON text.
Keep stdin open until replies arrive; close stdin or send SIGINT/SIGTERM to stop.
Protocol stdout has no startup logs. `mcp --json` is a usage error.

JSON envelopes carry `schema_version: 1`, `ok`, `data` or `error`, `diagnostics`,
and `degraded`. Exit codes are 0 success, 2 validation, 3 not found, 4 conflict,
5 operational failure, 6 usable degraded/incomplete result. Human diagnostics go
to stderr; `--json` emits a complete envelope on stdout. MCP tool failures set
`isError`; usable degraded reads remain successful tool results.

See [development notes](docs/DEVELOPMENT.md) for dependency choices, commands,
test isolation and platform evidence.

This is intentionally separate from [mdkb](https://github.com/ContractorKeith/mdkb),
providing a TypeScript learning ground for agent development, review, and testing.

MIT licensed.
