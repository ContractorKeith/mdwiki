# mdwiki — Build Plan

Status: M0 (#8) and M1 (#11, fba0eca) merged, 2026-11-02. M2 merged in PR #15; M3 is merged in PR #16; M4 merged in PR #17; M5 merged in PR #18; M6 packaging/release evidence merged in PR #19. Published tags/artifacts are tracked in GitHub releases; registry prerequisites are in docs/RELEASE.md.

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
| M0 | Runnable package, harness, cache schema seam, CI | None | Installed CLI version/help and real MCP initialize/list; both CI platforms | Merged #8 |
| M1 | Initialize, discover, list, tree, and read vault | M0 | Same fixture readable through installed CLI and MCP; boundary refusals | Merged #11 |
| M2 | Incremental SQLite FTS search and rebuild | M1 | CLI/MCP queries, tags, pagination, external edits, cache rebuild | Merged #15 |
| M3 | Wikilinks and backlinks | M2 | Resolver fixtures, ambiguous/missing targets, graph updates via CLI/MCP | Merged #16 |
| M4 | Writes, adoption, conflicts, dry-run | M3 | CLI/MCP create/replace/append, YAML preservation, conflicts and preview | Merged #17 |
| M5 | Watch, concurrency and recovery | M4 | External change propagation, multiple processes, interruption/restart | Merged #18 |
| M6 | Packaging, benchmark and release evidence | M5 | Fresh tarball install, documented workflows, 10k benchmark, all v0.1 checks | Merged #19 |

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
Standards/spec review covers the full diff against the pinned head. Use ordinary
code inspection and bounded deterministic fixture tests. Fixes receive regression
tests, rerun acceptance and updated CI. mdwiki does not use pr-attack or
skeptic-review, even when global skills suggest them. Use PR comments rather than
self-approval. Ready only after green macOS/Linux checks; merge with a merge
commit.

After merge: update this plan, issue state, Basecamp card step and central worklog;
explain what review found and proceed to the next ready milestone.
Before a release tag, verify the installed package on Linux and macOS using the
acceptance gate and bounded deterministic fixtures for documented workflows.
Record actual platform results, fix confirmed defects and rerun relevant checks.
A package tarball and release evidence can be completed without claiming npm
publication.

## M6 integration outcome

PR #19 merged as `a8cff09`; tested head `ca278bc` and merge trees match. Parent
ordinary full-diff review, 70 source +70 installed tests and final-head Linux/macOS
CI passed. Parent serial benchmark stayed within original budgets. The independently
reproduced tarball matches worker SHA-256
`08295b4bac30f6b7d287ed2a5c3f3823e1fdecf3dcf51255c122d33c8cc49823`.
Artifact and manifest: `/home/contractorkeith/.cache/mdwiki-m6-parent/artifacts/`.
All milestone issues are complete. Before registry publication, resolve package
name claimability and authenticated publisher access; E404/isolated ENEEDAUTH do not
establish either. No tag/publication occurred. Development audit findings and
performance/filesystem limits remain documented in DEVELOPMENT and RELEASE.

## v0.1.0 release preparation

PR #21 addressed the reproduced transient index-read conflict; parent 72 source
+ 72 installed tests and final-head Linux/macOS CI passed. The v0.1.0 changelog and
packaged artifact require a final candidate gate before tagging. Published artifacts
and tags are recorded at [GitHub Releases](https://github.com/ContractorKeith/mdwiki/releases).
Npm registry publishing remains subject to authenticated access and name ownership.
