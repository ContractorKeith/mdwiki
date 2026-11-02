# v0.1 observable acceptance mapping

Audit target: M6 against base `977eb1a1dca8e8f7e40cab06d1b5b5e18ec9f3d4` (M5).
The final head and actual platform/check state are recorded in the draft PR.
`bash scripts/accept.sh` remains the shared macOS/Linux command: strict check,
lint, build, all source tests, pack/install, all installed tests. No previous 66
source or 66 installed tests were removed. Four M6 cases bring each suite to 70.

Entries below identify exact test titles (unique prefixes where long) and their
observable assertions, rather than tests of documentation status prose. All test
paths are relative to the source checkout; they intentionally do not ship in npm.
Installed mode selects prefix/bin/mdwiki and installed core/schema modules; the
workflow tests additionally select examples/docs from that installed package.

## Every required coverage row in SPEC.md

| Spec acceptance row | Tests and observable proof |
|---|---|
| Initialization idempotency, discovery, external index, bounds, pagination | vault.test: `init preserves notes…` compares bytes, repeated init, canonical cache, nearest marker and binding conflicts; `pagination is bounded…` and `default and maximum pages…` check cursor bindings, 50/200/205 and tree truncation. cli.test: `real CLI initializes…` checks real nested-cwd discovery/flags. |
| List/read parity, Unicode/case, traversal/hidden paths/symlinks/hardlinks | vault.test: `listing and exact reads share policy…` reads every listed physical path and refuses unsafe ones; `list and tree refuse directories replaced…` controls identity transitions. writes.test: `exclusive create…` and `mutations preserve native physical case/Unicode…` refuse multi-link and alias-spelling writes and preserve native distinctions. |
| Search phrases/punctuation, frontmatter nesting, tags, excerpt and stable ties | search.test: `searches matching fields…` asserts title weighting, all fields, nested lexical values excluding keys/null, exact AND tags, phrases/operator lookalikes and bounded matching excerpts; `content hashes skip…` asserts equal-rank order. M6 `real CLI/MCP search defaults…` asserts exact 200-hit order, default 50, final 5, shared cursor and schema bounds through real transports. |
| External changes/removal, restored mtime edits, graph target/alias changes | search.test: `content hashes skip…` installs an FTS reinsertion failure trigger, restores mtime after same-size edit, verifies new hits and invalidated cursors/removal. backlinks.test: `graph reconciliation updates unchanged sources…` changes aliases/paths with unchanged sources and verifies graph results. watch.test real event tests cover create/change/rename/delete. |
| Duplicate filenames/aliases, fragments/embeds, code/comments and ambiguity | backlinks.test: `parses original link positions…`, `ordered resolver preserves exact spelling…`, `physical Unicode spelling…` assert source/root/name/alias precedence, ambiguity candidates, fragments and embeds, exclusion masks, exact case/extensions and bounded context/candidate pages. |
| YAML comments/custom fields, CRLF/BOM, malformed/unsupported input, adoption | vault.test: `raw reads preserve BOM/CRLF…` asserts byte digest and YAML scalar semantics/limits; `managed YAML types…` avoids unsafe integer coercion. writes.test: `adoption, replacement merge…`, `safe YAML aliases survive adoption…`, `real CLI/MCP replacements…` assert clock-driven metadata, preserved tokens/comments/BOM/CRLF/mode, supplied/omitted/null fields and refusal of malformed/unsupported types. |
| Dry-run no side effects, version conflicts, exclusive create, latest append | writes.test: `dry-run returns full before/after…` and `MCP previews do not mutate startup state…` snapshot bytes/entries/identity/mode/timestamps across vault and external parents; `exclusive create…`, `CLI file/stdin writes…`, `real CLI/MCP replacements…` assert exclusive/stale/deleted behavior and literal/latest append. Shipped workflows exercise the documented sequence. |
| Two real processes writing/indexing, failure after file publish, killed process | writes.test: `CLI file/stdin writes…`, `live mutation coordinator…`, `a paused real mutation…` prove serialization across cache choices, live exclusion and killed-holder release with stable inode; `publication failures clean temps…` and MCP post-publication test retain successful version despite index/finalization failure. search.test concurrent full rebuilds and watch.test `killed staged rebuild…` verify complete cache publication/recovery and stable index coordinator. |
| Watcher startup/missed-event recovery and shutdown, cache deletion/corruption | watch.test: `controlled attachment race…`, `dirty work arriving during scan…`, `active watch repairs…`, `persistent attachment failure…`, `unreadable watched notes…`, `shutdown during initial attachment…`, `queued post-publication reconciliation…`, `fatal runtime watch failure…` prove queue handshakes, periodic fallback, bounded retries and cleanup. Real watch and initialized MCP EOF/signals/stdout variants verify active shutdown. search/schema tests cover CLI deleted/corrupt/incompatible caches and unsafe recovery refusal. |
| MCP malformed input, unknown tool, wrong argument types, concurrent calls | mcp.test: `real MCP initializes…`, `malformed stdio input…`, `SDK scalar params…`, `M1 tools share envelopes…` assert exact eight schemas/tools, protocol-only stdout, errors, text/structured parity, continued usability and concurrent replies; search/backlinks/writes tests add tool-specific validation/parity. |
| Install tarball in clean prefix and run documented examples with binary | package.test: `npm pack builds…` packs an unbuilt copy with lifecycle build. scripts/package-smoke.mjs checks explicit package allowlist/size/docs/LICENSE, isolated install and reruns all tests. workflows.test executes shipped CLI shell and initialized Node-only MCP client; checks metadata, executable, docs and all locked license/version locations. Artifact retention includes manifest/SHA-256. |

## Feature matrix and user-story audit

| PLAN v0.1 feature / SPEC stories | Acceptance evidence above |
|---|---|
| Node/npm CLI + stdio MCP, strict TS and subprocess harness (stories 3, 11) | MCP row, install row, typecheck/lint/build; actual two-platform CI is required independently. |
| Existing folder, path boundaries, init/list/tree/read (stories 1, 2) | Init and path rows; raw read tests assert original full text/version, explicit invalid UTF-8/10 MiB errors. |
| Rebuildable SQLite FTS5, incremental sync and tags (stories 4, 5, 10) | Search/external-change/watch rows; schema.test creates real FTS tables, verifies reopen, vault binding and schema refusal; SQL batch rollback/failed discovery tests prohibit partial success. |
| Wikilinks, aliases, embeds, backlinks/ambiguity (story 9) | Graph rows; backlinks transport tests page diagnostics-only results and bind cursors to target/vault/generation/limit. |
| Create/replace/append, metadata, versions, dry-run (stories 6, 7, 8) | YAML/preview/process rows; 10 MiB UTF-8 input/result and large real MCP framing tests remain intact. |
| Watch, concurrent safety, recovery (stories 5, 10) | Process/watch rows; background MCP cache commit is observed without another tool request. |
| Artifact, docs, scale, release checks (story 11) | Installed examples/inventory/manifest tests, unchanged serial benchmark and RELEASE checklist; pending CI/parent gate cannot be inferred from local tests. |

## Cross-cutting contract audit and M6 gaps closed

CLI tests pin envelope version, help/version, stdout/stderr and exits 0/2/3/6;
writes assert conflict 4 and published-degraded 6; search/watch assert operational
5. Broken-pipe tests assert no stack trace. MCP tools pin strict argument schemas,
common structured/text envelopes and isError. Watch tests pin JSONL event fields,
monotonic sequence, UTC time, quiet scans, fatal exit and orderly shutdown.

M6 closes missing shipped operational docs/examples, metadata/license allowlist,
retained artifact/checksum and lockfile-wide dependency inventory with actual
package/file/process checks. It adds an explicit >200-hit CLI/MCP search pagination
and stable-tie regression; prior small tests did not establish full-size public
pages. Runnable examples fix the previous README's use-after-cleanup scratch
sequence and cover replacements/conflicts rather than merely printing commands.
The new package test initially failed for missing shipped docs; it now checks those
files in the installed package. No test asserts a documentation status sentence.

No identified functional acceptance row is left without an observable test.
This is a coverage audit, not proof against arbitrary filesystem races. macOS native
case/normalization behavior must pass its actual CI run; Linux alone is insufficient.
Registry claimability/authenticated publish access, parent review, both final-SHA CI
jobs and future release authorization remain release constraints. Benchmark scope
excludes graph-heavy, long-lived watch and mutation scale. The final external-editor
check-to-publication race and network/virtual watcher limits remain explicit.
