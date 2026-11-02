# mdwiki

Local-first knowledge base over ordinary Markdown files. mdwiki is intended to
complement an existing editor; files remain the source of truth.

M1 vault initialization, browsing and reading are merged in PR #11.
M2 incremental indexing and search are merged in PR #15. Not published.
Backlinks, writes and watching remain planned; see the [plan](docs/PLAN.md) and [v0.1 specification](docs/features/v0.1/SPEC.md).

Requires Node.js **26.13.0** (LTS; supported line: >=26.13.0 <27) and npm.
Development uses npm 11.20.0.

```sh
npm ci
bash scripts/accept.sh
node dist/cli.js --help
node dist/cli.js --version --json
```

The acceptance gate packs the compiled package, installs it in a disposable npm
prefix, and runs the installed executable. To inspect a local installation yourself:

```sh
scratch="$(mktemp -d)"
touch "$scratch/user.npmrc" "$scratch/global.npmrc"
export npm_config_cache="$scratch/npm-cache"
export npm_config_userconfig="$scratch/user.npmrc"
export npm_config_globalconfig="$scratch/global.npmrc"
npm pack --pack-destination "$scratch"
npm install --global --prefix "$scratch/prefix" --ignore-scripts "$scratch/mdwiki-0.1.0.tgz"
"$scratch/prefix/bin/mdwiki" --help
"$scratch/prefix/bin/mdwiki" --version
"$scratch/prefix/bin/mdwiki" help --json
"$scratch/prefix/bin/mdwiki" --json version
mkdir -p "$scratch/vault/nested"
printf '# Hello\n' > "$scratch/vault/hello world.MD"
printf '# Unicode\n' > "$scratch/vault/nested/é.md"
"$scratch/prefix/bin/mdwiki" init --vault "$scratch/vault" --index-dir "$scratch/cache"
"$scratch/prefix/bin/mdwiki" --vault "$scratch/vault" list --json
"$scratch/prefix/bin/mdwiki" tree --vault "$scratch/vault" --depth 3 --limit 200 --json
"$scratch/prefix/bin/mdwiki" read 'hello world.MD' --vault "$scratch/vault" --json
"$scratch/prefix/bin/mdwiki" reindex --vault "$scratch/vault" --json
"$scratch/prefix/bin/mdwiki" search Hello --vault "$scratch/vault" --json
"$scratch/prefix/bin/mdwiki" reindex --full --vault "$scratch/vault" --json
rm -rf "$scratch"
unset npm_config_cache npm_config_userconfig npm_config_globalconfig
```

Initialize an existing directory with `init --vault DIR`; notes are never rewritten.
Repeat init to reuse its persisted cache choice. For ordinary commands, `--vault`
wins; otherwise mdwiki finds the nearest initialized ancestor of the working
directory. Global flags work before or after commands. `--index-dir` overrides
the cache for an invocation without changing the persisted choice. A directory
cannot be reused as a cache for a different vault.

The discovery marker stays in `.mdwiki/config.json`. Its local `.gitignore`
excludes mdwiki artifacts from Git. Configure your sync tool separately to exclude
`.mdwiki`; Git ignore does not control Obsidian Sync or other sync services.

Lists contain exact relative paths, including extension. Spaces, Unicode and `.MD`
are supported. Hidden components, symlinks and attachments are excluded. Use
physical spelling, forward slashes, no absolute paths, dot segments or backslashes.
Reads return complete original text and SHA-256 of exact bytes, with metadata and
per-note diagnostics. Invalid YAML remains readable with degraded status; invalid
UTF-8 and notes over 10 MiB return explicit errors.

`list` defaults to 50 notes, maximum 200. Pass `next_cursor` back with the same
`--limit`; a changed vault generation requires restarting pagination. `tree`
defaults to depth 3 and at most 200 entries, returning explicit `truncated` state.
JSON tree entries are flat paths with `note` or `directory` type; depth 1 means
root entries. Truncation is a usable incomplete result (exit 6).

Search ANDs words and double-quoted phrases: `search 'design "local cache"'`.
Punctuation separates text; FTS operators are never executed. Search covers title,
path, body and nested metadata values, with title weighting, exact path tie order,
scores and excerpts of at most 484 characters. Repeat `--tag TAG` to require every
exact, case-sensitive frontmatter tag. Inline tags are not filters. Queries are
limited to 4096 characters and 128 clauses; at most 50 tags of 256 characters.
Search defaults to 50 results, maximum 200; reuse `next_cursor` with the same query,
filters and limit. A content change, failure change or full rebuild invalidates it.

`reindex` reconciles additions, edits and removals. Every indexed call rereads and
hashes eligible bytes; unchanged content skips parsing and FTS replacement. Until
M5 adds watching, search reconciles each call and MCP also reconciles at startup.
Invalid YAML uses raw-text search with diagnostics. Unreadable notes are excluded
from current hits with diagnostics; traversal failures fail the operation.

The vault-bound cache is disposable. Missing `index.sqlite` builds automatically;
corrupt/incompatible data requires `reindex --full` with the same vault/index-dir.
Full rebuild stages a complete database, then replaces only cache artifacts while
holding a persistent SQLite coordinator transaction. Cooperating processes wait
up to five seconds, then return an actionable retry error. Never delete the
coordinator or cache directory while mdwiki is running; see the recovery details
in [development notes](docs/DEVELOPMENT.md). Notes are never modified by indexing.

MCP clients launch the installed binary with `--vault DIR mcp`. Initialize the
vault through CLI first. The tools are exactly `mdwiki_list`, `mdwiki_tree`,
`mdwiki_read`, `mdwiki_search` and `mdwiki_reindex`. Arguments mirror command
options: read takes `path`; search takes `query`, optional `tags` (array), `limit`
and `cursor`; reindex takes optional boolean `full`.
They share CLI JSON envelopes in `structuredContent`, plus readable JSON text.
Keep stdin open until replies arrive; close stdin or send SIGINT/SIGTERM to stop.
Protocol stdout has no startup logs. `mcp --json` is a usage error.

JSON envelopes carry `schema_version: 1`, `ok`, `data` or `error`, `diagnostics`,
and `degraded`. Exit codes are 0 success, 2 validation, 3 not found, 4 conflict,
5 operational failure, 6 usable degraded/incomplete result. Human diagnostics go
to stderr; `--json` emits a complete envelope on stdout. MCP tool failures set
`isError`; usable degraded reads remain successful tool results.

See [development notes](docs/DEVELOPMENT.md) for dependency choices, commands,
test isolation and platform evidence.

This is intentionally separate from [mdkb](https://github.com/ContractorKeith/mdkb),
providing a TypeScript learning ground for agent development, review, and testing.

MIT licensed.
