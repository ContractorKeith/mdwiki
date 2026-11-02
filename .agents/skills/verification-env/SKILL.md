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

M0 and M1 are merged; M2 index/search is implemented pending review. Verify help/version,
text/JSON envelopes, validation errors, real MCP initialize/list-tools (exactly
mdwiki_list, mdwiki_tree, mdwiki_read, mdwiki_search, mdwiki_reindex), invalid arguments, unknown tools,
EOF/SIGINT/SIGTERM shutdown, and vault-bound SQLite FTS5/schema recovery.
Installed tests use prefix/bin/mdwiki with explicit npm prefix/cache/config paths.
Verify AND words/phrases, punctuation, all indexed fields, exact repeated tags,
excerpts, stale cursors, restored-mtime edits, unreadable notes, deleted/corrupt/old
data caches and concurrent full rebuilds. Run `npm run benchmark` for the disposable
10,000-note baseline; see docs/BENCHMARK.md. Writes/links/watching remain later milestones.

## Isolation

Create disposable scratch vaults and an isolated npm installation prefix. Pass
explicit `--vault` and `--index-dir` paths. Never access ~/vault, ~/Documents,
or other real notes. Do not repurpose HOME or CODEX_HOME. Clean only scratch
files you created. Keep fixtures under 100 MiB; /tmp may be shared memory storage.
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
- Later writes: stale versions, cooperating writers, dry-run side effects,
  interruption recovery, mode preservation and cache invalidation.
- Index and later watch: deleted/corrupt/old schema, recovery, permissions, missed
  events and orderly shutdown.
- Search and later graph: title/path/body/frontmatter, tags, phrases/punctuation,
  ambiguous links, aliases, code/comments and target changes.

## Platform evidence

Linux and macOS installed-package verification are both required before release;
both CI jobs must pass before merge. APFS may be case- and normalization-insensitive;
macOS temporary paths may have system symlink ancestors. Report the actual machine,
Node version, target SHA, checks run and limitations. Code inspection alone does
not establish a platform result. Record confirmed findings with deterministic
regression evidence; the orchestrator handles integration and central worklogs.
