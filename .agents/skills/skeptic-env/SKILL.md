---
name: skeptic-env
description: Build and adversarially test mdwiki in disposable vaults on macOS and Linux.
---

# mdwiki skeptic environment

Read AGENTS.md, docs/PLAN.md, and docs/features/v0.1/SPEC.md. Use a fresh
T3-managed worktree at the target SHA, never the author's checkout.

## Build and test

Node >=26.13.0 <27 is required; .nvmrc pins 26.13.0 LTS. Development uses
npm 11.20.0. Run `npm ci`, then `bash scripts/accept.sh`: typecheck, lint,
build, tests, npm pack, isolated prefix install, and installed CLI/MCP/SQLite tests.
Individual commands and dependency rationale are in docs/DEVELOPMENT.md.

M0 is merged in PR #8. Currently verify help/version in
text and JSON, validation errors, clean real MCP initialize/list-tools (empty),
unknown tools/invalid arguments, EOF/SIGINT/SIGTERM shutdown, and the private SQLite
FTS5/version seam. Installed tests use prefix/bin/mdwiki, with explicit npm prefix,
cache and config paths. Vault attacks below become applicable in later milestones;
do not claim those features passed based on M0 or skip existing runnable tests.

## Isolation

Create disposable scratch vaults and an isolated npm installation prefix. Pass
explicit `--vault` and `--index-dir` paths. Never access ~/vault, ~/Documents,
or other real notes. Do not repurpose HOME or CODEX_HOME. Clean only scratch
files you created. Keep fixtures modest; /tmp may be memory backed.

## Required attacks

- Paths: traversal, hidden paths, symlinked parents/notes/cache, case and Unicode.
- Notes: CRLF/BOM, YAML comments/custom fields, invalid YAML, duplicate names.
- Writes: stale version, simultaneous appends/replacements, dry-run side effects,
  interruption, mode preservation, cache invalidation, external editor races.
- Index: deleted/corrupt/old schema, interrupted reconciliation, permissions.
- MCP: real initialize sequence, invalid tool arguments, unknown tool, concurrent
  calls, clean stderr/stdout separation and shutdown. Keep stdin open until replies.
- Search and graph: title/path/body/frontmatter, tags, phrase and punctuation,
  ambiguous links, aliases, code/comments, stale backlink targets after changes.
- Packaging: fresh npm tarball install, every documented command, bounded output.

Linux and macOS are both required for release verification. APFS may be case- and
normalization-insensitive; temporary paths on macOS may have symlinked ancestors.
Report the actual machine, Node version, target SHA and checks run. Do not claim
either platform from reviewing code alone. No fixes or central worklog edits by
the reviewer; the orchestrator triages and files the report.
