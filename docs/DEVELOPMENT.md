# Development

M0 is merged in PR #8; M1 is implemented pending review, not published. Node 26.13.0 and npm
11.20.0 were used on Linux x86_64. The supported Node line is >=26.13.0 <27,
enforced by package engines and the acceptance script; .nvmrc pins CI to 26.13.0.

## Gate and commands

Run `npm ci`, then `bash scripts/accept.sh`. The latter runs, in order:

1. `npm run typecheck`: strict TypeScript, including dependency declarations.
2. `npm run lint`: ESLint over source, tests and scripts.
3. `npm run build`: compiled ESM JavaScript in dist, including the executable.
4. `npm test`: CLI/MCP subprocess scenarios and SQLite integration tests.
5. `npm run test:installed`: npm pack, isolated global-prefix install, then the
   same scenarios through the executable in prefix/bin and the installed schema module.

Ordinary `npm pack` runs the prepack build hook, so a clean source checkout cannot
silently produce a tarball without the executable. The gate's pack runner uses
`--ignore-scripts` only after its explicit build; a separate regression test packs
an unbuilt source copy with lifecycle scripts enabled.

The installed test uses explicit temporary npm prefix, cache, user config and
global config paths, ignores lifecycle scripts, and removes only its own temporary
directory in a finally block. Registry access is required for dependency install;
application runtime tests do not use the network. No HOME/CODEX_HOME changes.

The GitHub Actions matrix runs `npm ci` and precisely `bash scripts/accept.sh`
on ubuntu-latest and macos-latest, with no platform skips. Local Linux results
cannot substitute for a completed green macOS job; the orchestrator verifies both
before merge. M0 does not supply release or benchmark evidence.

## Runtime choices and direct dependencies

Versions are exact in package.json and transitive resolutions/integrities are in
package-lock.json. No global CLI, native addon, ORM or framework is needed.

| Dependency | Version | License | Concrete benefit |
|---|---|---|---|
| Node.js | 26.13.0 | MIT with bundled third-party notices | Current LTS, built-in test runner and SQLite avoid extra runtime/build dependencies |
| @modelcontextprotocol/server | 2.4.0 | Apache-2.0 | Official stable v2 SDK owns protocol framing, negotiation, schema validation and stdio lifecycle |
| zod | 4.6.7 | MIT | Pins the SDK's compatible Zod 4 validator (SDK requires ^4.2.0), rather than a separate validation mechanism |
| yaml | 2.9.1 | ISC | YAML 1.2 document parser retains comments/source tokens and supports bounded safe metadata validation without rewriting notes |
| typescript | 6.0.3 | Apache-2.0 | Strict static checking and portable compiled JavaScript |
| @types/node | 26.6.6 | MIT | Node 26 API declarations, including node:sqlite |
| eslint | 10.14.0 | MIT | Static checks for source and the runnable test/gate scripts |
| @eslint/js | 10.0.1 | MIT | Official recommended JavaScript lint rules |
| typescript-eslint | 8.72.1 | MIT | TypeScript parser/rules integrated with the same lint command |

TypeScript 7.0.2 is newer but outside typescript-eslint 8.72.1's supported
`>=4.8.4 <6.1.0` peer range. TypeScript 6.0.3 installs without peer bypasses.
SDK 2.4.0 requires Node >=20 and depends on Zod ^4.2.0; the pinned runtime and
validator satisfy those requirements. No prerelease dependency is selected.

Verification sources (checked 2026-11-02):
[Node release status](https://nodejs.org/en/about/previous-releases),
[official stable SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/),
and published npm metadata (`npm view PACKAGE@VERSION engines dependencies license`).

Node's [SQLite API](https://nodejs.org/docs/latest-v26.x/api/sqlite.html) is
supported without a flag but still has stability 1.2 (release candidate).
We use its small synchronous DatabaseSync API for the private M0 seam as the spec
prefers the built-in API. This avoids native-addon installation and ABI coupling;
the acceptance tests prove FTS5 with an actual virtual table, parameterized insert,
MATCH, persistence and reopen on each tested platform. Do not describe the Node
SQLite API itself as stable. Later indexing performance is an M2 concern.

At implementation time, `npm audit --omit=dev` reports zero vulnerabilities.
The full audit reports 11 moderate findings through development-only minimatch
(<11.0.1; GHSA-g3hv-75wg-m249). These affect lint tooling, not the installed
runtime. No unsupported major override or forced peer bypass is applied.

## Current seams and limits

src/core owns initialization/discovery, cache binding, exact path policy, bounded
file reads and YAML parsing. src/operations.ts owns shared input schemas and
application calls. CLI and MCP only select a vault and translate arguments/results.
The active cache is bound by vault.json; the discovery marker persists its default
location. Both contain schema_version 1 and canonical vault/index_dir paths.
Changing an initialized marker's vault binding or reusing a bound cache conflicts.
Metadata symlinks are refused; the selected root is canonicalized, including normal
macOS temporary-directory ancestors. macOS system /var and /tmp ancestors of cache
paths are canonicalized, without accepting symlinked cache entries.

List cursors bind canonical vault, filesystem generation, page size and offset.
The M1 generation hashes sorted physical paths, sizes, nanosecond mtime/ctime and
folder paths; it is a filesystem observation, not an indexed snapshot. Traversal
failures fail the operation instead of publishing a partial success. Ordering uses
exact JavaScript string comparison, without case folding or Unicode normalization.
Tree depth is 1–50, entries 1–200; depth 1 is root entries. List is 1–200 (default 50).
Read paths are at most 4096 characters, cursors 2048. Reads are at most 10 MiB,
including BOM, and decoding rejects invalid UTF-8. File handles use O_NOFOLLOW and
check identity/path state around reads. Concurrent external changes can require a
retry; these filesystem observations do not provide a transaction with editors.

Frontmatter is a YAML 1.2 core mapping, bounded to depth 50, 100 expanded alias
references and 100,000 visited values. Unsupported tags/types, duplicate/non-string
keys, cycles and nonfinite numbers yield INVALID_FRONTMATTER diagnostics; invalid
managed fields yield INVALID_METADATA. Failed parsing exposes empty metadata and
retains the raw content. Missing frontmatter needs no diagnostic. JSON metadata
uses strings for integers outside the safe Number range, preserving scalar source
spelling; date-like scalars remain strings. yaml document/source tokens preserve
comments and lexical types for later writes; M1 performs no adoption or mutation.

Stable application errors: VALIDATION_ERROR, UNSAFE_PATH, INVALID_UTF8 and
SIZE_LIMIT exit 2; NOT_FOUND exits 3; CONFLICT exits 4; CONFIG_ERROR and
OPERATIONAL_ERROR exit 5. Successful diagnostic-bearing reads and truncated trees
exit 6. Error envelopes never include internal stack traces or raw filesystem errors.

src/mcp.ts delegates stdio to the SDK. The precise published tool schemas are also
validated at the shared application seam, allowing valid tools/call envelopes with
invalid M1 arguments to return structured VALIDATION_ERROR results consistently.
Tests exercise initialize/initialized, exact tool names/schemas, real calls,
invalid argument and cursor types, unknown tools/methods, concurrent requests, EOF
and SIGINT/SIGTERM. Every stdout line must be protocol JSON; diagnostics use stderr.
Malformed protocol envelopes remain SDK-owned: scalar params may be diagnosed
without a response, and malformed protocol tools/list cursors may receive -32603.
Bounded callers must not wait indefinitely for a malformed-envelope reply. This is
distinct from validated mdwiki_list cursor arguments; no protocol fork is used.

src/index/schema.ts is private, not a CLI command or public raw-SQL interface.
It creates only capability_fts and PRAGMA user_version=1 on an explicitly supplied
disposable file, retains rows on reopen, and refuses incompatible versions without
rewriting them. This is a capability/schema seam, not the final vault cache schema
or a cache recovery implementation. Vault operations do not yet use this private capability cache.

The seam also refuses an ordinary table masquerading as `capability_fts`, preserving
its original schema version and rows. This check does not replace M2's full cache
schema validation and recovery work.

Tests use temporary directories with tiny fixtures, outside real vaults. Each child
has an 8-second timeout and cleanup hook; the pack/install runner has bounded
120-second child commands and always removes its scratch directory. MCP stdin
stays open until all expected replies arrive. No fixed sleeps establish correctness.

Later milestones add index/search (M2), links (M3), writes
(M4), watching/recovery (M5) and release/benchmark evidence (M6).
