# Changelog

## 0.1.0 — 2026-11-03

- Browse, list, read and search existing Markdown vaults through CLI and eight
  stdio MCP tools; files remain authoritative.
- Incremental SQLite FTS5 search, exact tags, bounded pagination, wikilinks and
  backlinks with explicit ambiguity diagnostics.
- Metadata-preserving create, content-version replacement, latest append and
  side-effect-free previews, with cooperative writer/index coordination.
- Lazy MCP watching, explicit foreground watch, missed-event reconciliation,
  bounded recovery and clean shutdown.
- Retry one transient index-read conflict during atomic note publication;
  persistent conflicts still exclude stale data and report diagnostics.
- Shipped disposable CLI/MCP examples, dependency/license inventory and
  Linux/macOS source plus installed-package acceptance coverage.

Requires Node >=26.13.0 <27. No atomic compare-and-swap with external editors;
network filesystem notifications remain platform-dependent. Indexed calls still
hash files. See docs/RELEASE.md for artifact verification and publishing state.
