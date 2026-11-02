# Install and use a disposable vault

Node >=26.13.0 <27 and npm are prerequisites; development/CI pins Node 26.13.0
and npm 11.20.0. No global MCP client, SQLite executable, compiler or other npm
package is needed at runtime. Download/install dependencies requires registry
access; operating on notes does not. No registry publication is claimed yet.

From a source checkout, build and install a tarball into an owned prefix:

```sh
scratch="$(mktemp -d "$PWD/.scratch-install-XXXXXXXX")"
mkdir "$scratch/tmp"
touch "$scratch/user.npmrc" "$scratch/global.npmrc"
export TMPDIR="$scratch/tmp"
export npm_config_cache="$scratch/npm-cache"
export npm_config_userconfig="$scratch/user.npmrc"
export npm_config_globalconfig="$scratch/global.npmrc"
export npm_config_prefix="$scratch/prefix"
npm ci
npm pack --pack-destination "$scratch"
npm install --global --prefix "$scratch/prefix" --omit=dev --ignore-scripts --no-audit --no-fund "$scratch/mdwiki-0.1.0.tgz"
installed="$scratch/prefix/lib/node_modules/mdwiki"
export MDWIKI_BIN="$scratch/prefix/bin/mdwiki"
bash "$installed/examples/cli-workflow.sh"
node "$installed/examples/mcp-workflow.mjs" "$MDWIKI_BIN"
# Only after all example processes have exited:
rm -rf "$scratch"
unset TMPDIR npm_config_cache npm_config_userconfig npm_config_globalconfig npm_config_prefix MDWIKI_BIN
```

Choose a workspace filesystem with free quota. Shared `/tmp` can be quota-limited;
the example puts scratch, cache, npm config and prefix on the checkout filesystem.
Do not reuse a directory or substitute your real notes. HOME/CODEX_HOME stay intact.
If you already set these variables, run this block in a subshell to preserve them.

The shipped `examples/cli-workflow.sh` owns and cleans a tiny synthetic vault. It
runs help/version, repeated init with an external cache, list, tree, nested-cwd
read/discovery, incremental/full reindex, search, backlinks, file/stdin create,
side-effect-free preview, read-version replacement, stale conflict (exit 4), and
latest append. It uses Node to extract the version, without jq or a global package.
The acceptance gate executes this exact script using the installed binary.

For your own existing folder, initialize it explicitly with `mdwiki init --vault DIR`.
The marker is `.mdwiki/config.json`; later commands discover the nearest ancestor
marker or use explicit `--vault DIR`. An external `--index-dir DIR` at init persists;
an invocation override does not change that choice. Initialization/indexing never
rewrite notes. Exclude `.mdwiki` in your sync tool separately: Git ignore does not
configure Obsidian Sync. Never delete a live coordinator to clear a cache.

Foreground watching uses `mdwiki --vault DIR watch --json` (JSON Lines), or omit
`--json` for human output. Keep stdin open; close it or send SIGINT/SIGTERM to stop.
`ready` is the startup handshake, `sync` reports committed changes, `diagnostic`
reports recoverable failure/retry, `stopped` signals orderly exit 0, and fatal `error`
exits 5. Quiet scans emit nothing. The installed watch tests exercise these events,
external edits and cache recovery without fixed sleeps. See README for event fields,
retry/periodic scan intervals and filesystem limits.

List/search/backlinks use limit 50 by default, maximum 200. Pass `next_cursor` with
the original query/filter/limit; restart on a stale generation. Tree defaults to
depth 3 / 200 entries and reports truncation (exit 6). Read/write use exact visible
forward-slash paths including `.md` (extension matching is case-insensitive but
physical spelling is retained). Hidden paths, symlinks and traversal are refused;
write refuses hardlinks. A note or write body is at most 10 MiB UTF-8; reads never
silently truncate. Search is words and double-quoted phrases ANDed, plus repeated
exact case-sensitive `--tag`; inline tags are not filters. See README for full bounds.

Writes adopt managed title/created/updated/tags while preserving custom YAML,
comments, BOM and newline style. Replacement merges supplied metadata and replaces
the body; append input is literal. Preview reserves nothing. Supply the SHA-256
`content_version` returned by read as `--expected-version` for replacement. Create
has no version and refuses an existing path. Append operates on latest bytes under
the shared mutation coordinator. Atomic publication still has a final race with
uncoordinated external editors; there is no atomic external compare-and-swap.

Every JSON command returns schema version 1; errors use stable code/message and
human diagnostics use stderr. Exit codes: 0 success, 2 validation, 3 not found,
4 conflict, 5 operational failure, 6 usable degraded/incomplete result. After a
published write, `file_written: true` and its new version remain success even if
`index.ok: false` and `degraded: true`. Do not retry append; repair/reconcile instead.
See [agent contracts](AGENTS.md) for structured results and [development](DEVELOPMENT.md)
for safe cache/coordinator recovery.
