# mdwiki

Local-first knowledge base over ordinary Markdown files. mdwiki is intended to
complement an existing editor; files remain the source of truth.

M1 vault initialization, browsing and reading are implemented pending review.
Not published. Indexing, search, backlinks, writes and watching remain planned; see the [plan](docs/PLAN.md) and [v0.1 specification](docs/features/v0.1/SPEC.md).

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

MCP clients launch the installed binary with `--vault DIR mcp`. Initialize the
vault through CLI first. The tools are exactly `mdwiki_list`, `mdwiki_tree` and
`mdwiki_read`; their arguments mirror command options (`read` takes `path`).
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
