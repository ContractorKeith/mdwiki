# mdwiki

Local-first knowledge base over ordinary Markdown files. mdwiki is intended to
complement an existing editor; files remain the source of truth.

M0 runtime and acceptance harness merged in PR #8. Not published.
Vault commands, indexing, search, backlinks, writes and watching remain
planned; see the [plan](docs/PLAN.md) and [v0.1 specification](docs/features/v0.1/SPEC.md).

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
rm -rf "$scratch"
unset npm_config_cache npm_config_userconfig npm_config_globalconfig
```

MCP clients can launch that installed binary with the argument `mcp`. M0 supports
real stdio initialization and an empty tools list. Keep stdin open until replies
arrive; close stdin or send SIGINT/SIGTERM to stop. Protocol stdout has no startup
logs. `mcp --json` is a usage error.

Help/version succeed with exit 0. Invalid arguments fail with exit 2 and stable
`VALIDATION_ERROR`; human errors go to stderr, or JSON envelopes to stdout with
`--json`. Unexpected startup failures use `OPERATIONAL_ERROR` and exit 5.
JSON envelopes carry `schema_version: 1`, `ok`, `data` or `error`,
`diagnostics`, and `degraded`. No M0 command opens a vault or creates a cache.

See [development notes](docs/DEVELOPMENT.md) for dependency choices, commands,
test isolation and platform evidence.

This is intentionally separate from [mdkb](https://github.com/ContractorKeith/mdkb),
providing a TypeScript learning ground for agent development, review, and testing.

MIT licensed.
