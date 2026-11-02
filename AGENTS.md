# mdwiki

Local-first Markdown knowledge base for people and agents: TypeScript on Node.js LTS,
one npm package with CLI and stdio MCP, SQLite FTS5, backlinks, and incremental
watching. Existing vault files are authoritative; the index is disposable. This
separate project deliberately practices agent implementation, review, and testing.

## Status
M0 runtime and harness implemented pending review — 2026-11-02. Not merged.
Vault product behavior remains planned for M1–M6.

## Commands
Node >=26.13.0 <27 (.nvmrc: 26.13.0), npm 11.20.0. Run `npm ci`, then
`bash scripts/accept.sh`: typecheck, lint, build, tests, npm pack and isolated
installed-package CLI/MCP/SQLite checks. CI runs the same gate on macOS/Linux.
See `docs/DEVELOPMENT.md` for individual commands and dependency rationale.

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
