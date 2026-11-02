---
name: skeptic-env
description: Build and adversarially test mdwiki in disposable vaults on macOS and Linux.
---

# mdwiki skeptic environment

Read AGENTS.md, docs/PLAN.md, and docs/features/v0.1/SPEC.md. Use a fresh
T3-managed worktree at the target SHA, never the author's checkout.

## Build and test

Node.js LTS and npm are required. M0 must pin the supported Node line and fill
the actual package commands here. Before M0, `bash scripts/accept.sh` checks
only planning artifacts and is not evidence of application correctness.
After M0, install with `npm ci`, run `bash scripts/accept.sh`, and exercise the
npm-packed/installed command, not only a development entry point.

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
