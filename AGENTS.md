# mdwiki

Local-first Markdown knowledge base for people and agents: TypeScript on Node.js LTS,
one npm package with CLI and stdio MCP, SQLite FTS5, backlinks, and incremental
watching. Existing vault files are authoritative; the index is disposable. This
separate project deliberately practices agent implementation, review, and testing.

## Status
Planning scaffold — 2026-11-02. No application implemented yet. M0 is next.

## Commands
`bash scripts/accept.sh` is the shared acceptance entry point. Until M0 it checks
the planning scaffold only. M0 must replace that with typecheck, lint, build,
tests, and installed-package smoke tests; CI runs the same command on macOS/Linux.

## Pointers
- `CONTEXT.md` — project glossary.
- `docs/PLAN.md` — milestones, dependencies, status and release gate.
- `docs/features/v0.1/SPEC.md` — canonical product and interface contracts.
- `.agents/skills/skeptic-env/SKILL.md` — isolated verification environment.
- Central worklog: `~/Projects/worklog/projects/mdwiki.md` on Linux.

## Conventions & Gotchas
- Core owns vault rules and filesystem access; index owns SQL; CLI/MCP call the
  same application operations. Do not duplicate product rules in transports.
- Strict TypeScript. Keep modules focused and interfaces small. Dependencies
  require a concrete benefit; pin a lockfile. No ORM or plugin framework.
- MCP writes enabled by default. Exact paths only. Replacement requires content
  version; append uses latest content. Dry-run changes neither notes nor cache.
- Do not follow symlinks or hidden paths. Never use the user's real vault in tests.
- Preserve custom YAML and comments. Indexing never rewrites note files.
- Native filesystem comparison differs on APFS; test Unicode/case behavior.
- Do not promise atomic compare-and-swap with noncooperating external editors.
- Commits: `<type>: <description>`, ContractorKeith only, no AI attribution.

## Tracking and execution
One milestone = one issue = one branch = one draft PR = one T3 worktree thread.
Workers use GPT-6.1 Sol, medium effort; do not delegate or write central worklogs.
Astra owns integration. M0 lands alone; first usable CLI/core/MCP path is sequential.
Before merge: orchestrator full-diff review and acceptance rerun, independent
standards/spec review, independent live attack, fixes verified, both CI jobs green.
Merge commits preserve milestone history. Explain lessons, then continue without
asking for merge permission. The orchestrator records worklog and Basecamp updates.

## Out of scope
Semantic search, TUI, local ask, inline tags, daily/tasks features, web/Tauri UI,
automatic Git history, imports, cross-vault search, Windows, cloud and telemetry.
