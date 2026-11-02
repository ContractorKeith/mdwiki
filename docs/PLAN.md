# mdwiki — Build Plan

Status: M0 implemented pending review, 2026-11-02; not merged. M1–M6 remain planned.

## Goal and source of truth

Deliver the [v0.1 specification](features/v0.1/SPEC.md) on macOS and Linux.
That document is the sole full product spec. This plan tracks execution.
The grill was confirmed and implementation authorized on 2026-11-02.

Prior art: mdkb supplies process, scratch testing, and independent review lessons.
Do not copy its Go architecture, separate-vault default, or Git-committed writes.
Build process: https://app.basecamp.com/6307587/buckets/49448999/documents/10464058936.

## Milestones

| M | Outcome | Depends on | End-to-end proof | Status |
|---|---|---|---|---|
| M0 | Runnable package, harness, cache schema seam, CI | None | Installed CLI version/help and real MCP initialize/list; both CI platforms | Implemented pending review |
| M1 | Initialize, discover, list, tree, and read vault | M0 | Same fixture readable through installed CLI and MCP; boundary refusals | Planned |
| M2 | Incremental SQLite FTS search and rebuild | M1 | CLI/MCP queries, tags, pagination, external edits, cache rebuild | Planned |
| M3 | Wikilinks and backlinks | M2 | Resolver fixtures, ambiguous/missing targets, graph updates via CLI/MCP | Planned |
| M4 | Writes, adoption, conflicts, dry-run | M3 | CLI/MCP create/replace/append, YAML preservation, conflicts and preview | Planned |
| M5 | Watch, concurrency and recovery | M4 | External change propagation, multiple processes, interruption/restart | Planned |
| M6 | Packaging, benchmark and release evidence | M5 | Fresh tarball install, documented workflows, 10k benchmark, all v0.1 checks | Planned |

M0 lands alone. The core mutation/index interactions justify a sequential chain;
do not manufacture parallel branches with shared ownership. Independent reviews
may run in parallel once their target commit is fixed. Integration order M0–M6.

## Feature matrix

| Feature | Decision | Milestone |
|---|---|---|
| Node/npm CLI + stdio MCP, strict TS, real subprocess harness | v0.1 | M0 |
| Existing folder, path boundaries, init/list/tree/read | v0.1 | M1 |
| Rebuildable SQLite/FTS5, incremental sync, tag filtering | v0.1 | M2 |
| Wikilinks, aliases, embeds, backlinks and ambiguity diagnostics | v0.1 | M3 |
| Create/replace/append, managed frontmatter, version checks, dry-run | v0.1 | M4 |
| MCP watcher, explicit watch, concurrent-process safety and recovery | v0.1 | M5 |
| npm artifact, operational docs, scale and release checks | v0.1 | M6 |
| Semantic/hybrid search, local ask, daily/tasks, inline tags, TUI | Later | — |
| Git history, orphan/link repair, graph export, optional viewer | Later | — |
| Required accounts, telemetry, authoritative index | Drop | — |

## Verification and process

`bash scripts/accept.sh` is the same gate for workers, orchestrator, reviewers and
CI. M0 supplies typecheck, lint, build, real tests and isolated tarball installation. Every milestone
extends it with observable proofs and never weakens existing checks.

One issue/branch/draft PR/T3 worktree thread per milestone, Sol 6.1 medium.
Orchestrator checks the complete base-to-head diff and reruns acceptance.
Independent standards/spec reviewers and a separate live PR attacker report
against the pinned head. Fixes receive regression tests, rerun acceptance and
updated CI. Use PR comments rather than self-approval. Ready only after green
macOS/Linux checks; merge with a merge commit.

After merge: update this plan, issue state, Basecamp card step and central worklog;
explain what review found and proceed to the next ready milestone.
Before a release tag, run independent skeptic passes on Linux and macOS, triage
findings, file labelled issues for confirmed defects, fix and verify. A package
tarball and release evidence can be completed without claiming npm publication.
