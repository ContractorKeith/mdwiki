# Development

M0 is merged in PR #8, not published. Node 26.13.0 and npm
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

src/cli.ts validates only help/version/mcp arguments. Shared envelope constructors
live in src/output.ts; version metadata comes from the packaged package.json.
No later command is advertised as implemented. Global --json works before/after
help/version; MCP rejects it before starting.

src/mcp.ts delegates stdio to the SDK. Tests perform real initialize and initialized
notification exchange using the supported 2025-11-25 protocol, list tools, ping,
unknown tools/methods, bad arguments, malformed input, concurrent requests, EOF
and both termination signals. All stdout lines must parse as protocol JSON;
diagnostics use stderr. SDK v2 handles protocol negotiation (including newer
clients); the explicit initialize harness proves the supported legacy exchange.
Tools/results for vault operations are introduced by later milestones.

src/index/schema.ts is private, not a CLI command or public raw-SQL interface.
It creates only capability_fts and PRAGMA user_version=1 on an explicitly supplied
disposable file, retains rows on reopen, and refuses incompatible versions without
rewriting them. This is a capability/schema seam, not the final vault cache schema
or a cache recovery implementation. No note discovery or filesystem product rules
have been implemented.

The seam also refuses an ordinary table masquerading as `capability_fts`, preserving
its original schema version and rows. This check does not replace M2's full cache
schema validation and recovery work.

Tests use temporary directories with tiny fixtures, outside real vaults. Each child
has an 8-second timeout and cleanup hook; the pack/install runner has bounded
120-second child commands and always removes its scratch directory. MCP stdin
stays open until all expected replies arrive. No fixed sleeps establish correctness.

Later milestones add vault operations (M1), index/search (M2), links (M3), writes
(M4), watching/recovery (M5) and release/benchmark evidence (M6).
