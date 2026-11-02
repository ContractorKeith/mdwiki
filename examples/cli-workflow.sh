#!/usr/bin/env bash
# Disposable example; TMPDIR may point at an owned workspace filesystem directory.
set -euo pipefail
mdwiki_bin="${MDWIKI_BIN:-mdwiki}"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/mdwiki-example-XXXXXXXX")"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/vault/nested"
printf '# Hello\n' > "$scratch/vault/hello world.MD"
printf '# Unicode\n' > "$scratch/vault/nested/é.md"
"$mdwiki_bin" --help
"$mdwiki_bin" --version --json
"$mdwiki_bin" init --vault "$scratch/vault" --index-dir "$scratch/cache" --json
"$mdwiki_bin" init --vault "$scratch/vault" --json
"$mdwiki_bin" --vault "$scratch/vault" list --limit 1 --json
"$mdwiki_bin" tree --vault "$scratch/vault" --depth 3 --limit 200 --json
(cd "$scratch/vault/nested" && "$mdwiki_bin" read 'hello world.MD' --json)
"$mdwiki_bin" reindex --vault "$scratch/vault" --json
"$mdwiki_bin" search Hello --vault "$scratch/vault" --json
printf '[[hello world|Hello]]\n' > "$scratch/vault/source.md"
"$mdwiki_bin" backlinks 'hello world.MD' --vault "$scratch/vault" --json
printf '# New note\n' > "$scratch/input.md"
"$mdwiki_bin" --vault "$scratch/vault" write new.md --file "$scratch/input.md" --dry-run --json
test ! -e "$scratch/vault/new.md"
"$mdwiki_bin" --vault "$scratch/vault" write new.md --file "$scratch/input.md" --json
version="$("$mdwiki_bin" --vault "$scratch/vault" read new.md --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).data.content_version))')"
printf '# Replaced note\n' | "$mdwiki_bin" --vault "$scratch/vault" write new.md --file - --expected-version "$version" --json
set +e
printf 'stale\n' | "$mdwiki_bin" --vault "$scratch/vault" write new.md --file - --expected-version "$version" --json
status=$?
set -e
test "$status" -eq 4
printf 'More text\n' | "$mdwiki_bin" --vault "$scratch/vault" append new.md --file - --json
"$mdwiki_bin" reindex --full --vault "$scratch/vault" --json
"$mdwiki_bin" read new.md --vault "$scratch/vault" --json
