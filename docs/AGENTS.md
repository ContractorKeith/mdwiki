# Agent and MCP contract

Launch the installed executable with `["--vault", "/absolute/vault", "mcp"]` after
CLI initialization. One vault is selected for the process; tools cannot override
it. `mcp --json` is a usage error. stdout contains only newline-delimited JSON-RPC;
operational diagnostics go to stderr. Keep stdin open until expected replies arrive.

`examples/mcp-workflow.mjs` is a Node-only reference client shipped in the package:

```sh
node /absolute/prefix/lib/node_modules/mdwiki/examples/mcp-workflow.mjs /absolute/prefix/bin/mdwiki
```

It owns a disposable initialized vault, performs the real initialize handshake,
lists tools and calls all eight tools, including preview/create/read-version
replace/stale conflict/append, search/backlinks and full rebuild. It checks replies,
closes stdin after the last reply, reaps the child, then removes only its scratch.
The installed acceptance suite runs this exact client. Clients normally supply an
existing vault rather than creating a fixture.

The handshake is `initialize` with `protocolVersion: "2025-11-25"`, `capabilities: {}`
and `clientInfo: {name, version}`, followed by `notifications/initialized`. Send
`tools/list` to obtain the authoritative JSON schemas and `tools/call` with
`{name: "mdwiki_read", arguments: {path: "note.md"}}`, for example.

All argument objects are strict (unknown fields refused). Strings are not coerced
from numbers; booleans are not strings. Optional means omit, not null.

| Tool | Required arguments | Optional arguments |
|---|---|---|
| mdwiki_list | none | limit, cursor |
| mdwiki_tree | none | depth, limit |
| mdwiki_read | path | none |
| mdwiki_search | query | tags (string array), limit, cursor |
| mdwiki_backlinks | path | limit, cursor |
| mdwiki_write | path, content | expected_version, dry_run |
| mdwiki_append | path, content | dry_run |
| mdwiki_reindex | none | full |

Paths are 1–4096 characters, exact vault-relative physical spelling including
extension, with no hidden/dot/traversal/backslash segments. Limit is integer 1–200
(default 50); tree depth 1–50 (default 3), tree limit defaults to 200. Cursor is
1–2048 characters and bound to vault/generation/limit and query/filters/target as
applicable. Query is 1–4096 characters, at most 128 searchable word/phrase clauses;
tags at most 50 nonempty strings of at most 256 characters. Version is exactly
64 lowercase hex characters. Content schema bounds characters to 10 MiB and core
additionally enforces 10 MiB UTF-8 input/result bytes. dry_run/full are booleans.
Incoming MCP frames are bounded to 6 × 10 MiB + 64 KiB. Large preview responses
may require 264 MiB framing capacity; send large requests individually.

Successful CLI JSON and MCP `structuredContent` share:

```json
{"schema_version":1,"ok":true,"data":{},"diagnostics":[],"degraded":false}
```

Errors replace `data` with `error: {code, message}` and have `ok: false`.
Diagnostics contain `code`, `message`, optional note `path`. MCP also returns
readable JSON in `content[0].text` and `isError` true for application errors;
usable degraded results remain `isError: false`. Invalid protocol envelopes,
unknown methods/tools and malformed frames are SDK transport errors, not guaranteed
application envelopes. Do not wait indefinitely for malformed-envelope replies.

| Operation | Main data fields |
|---|---|
| list | entries [{path}], next_cursor, generation |
| tree | entries [{path, type}], depth, limit, truncated, generation |
| read | path, content (full original text), content_version, title, metadata |
| search | entries [{path, title, score, excerpt}], next_cursor, generation |
| backlinks | entries [{path, occurrence}], link_diagnostics, next_cursor, generation |
| reindex | vault, index_dir, added, changed, removed, unchanged, generation |
| write/append | path, dry_run, file_written, current_version, proposed_version; preview also diff, real writes also content_version and index |

Read and preview sessions remain free of cache/config/lock mutations: startup and
initialize/list/tree/read do not activate watching. First indexed operation or
successful real write activates reconciliation/watching. Indexed calls await known
dirty work and reconcile bytes. Shutdown on stdin EOF/SIGINT/SIGTERM releases resources.

For replacement, read, retain `content_version`, then write with `expected_version`.
A stale or deleted target yields CONFLICT; never silently retry with create.
Create omits expected_version and refuses existing targets. Append uses latest
contents under the vault-wide lock, independently of cache settings. Preview has
`diff: {before, after}`, full text and current/proposed versions; it is not a lock
or reservation. Revalidate on actual write. Preserve custom metadata; explicit
custom null is a value, not deletion. No editor-wide atomic CAS is promised.

When `file_written: true`, record the returned content_version even if degraded.
`index: {ok: false, error}` and INDEX_UPDATE_FAILED mean the note was published:
**never blindly retry append**. PUBLICATION_CLEANUP_FAILED likewise preserves
publication success. Repair the index using reindex/full recovery. Stable errors:
VALIDATION_ERROR, UNSAFE_PATH, INVALID_UTF8, SIZE_LIMIT, NOT_FOUND, CONFLICT,
CONFIG_ERROR, OPERATIONAL_ERROR. CLI exit/status and watch JSONL contracts are in
[usage](USAGE.md) and README; exact paths, bounded graph contexts and diagnostic
pagination are described there and in the [spec](features/v0.1/SPEC.md).
