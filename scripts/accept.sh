#!/usr/bin/env bash
# Planning-only acceptance. M0 replaces this with the real application gate.
set -eu
cd "$(dirname "$0")/.."
test -s AGENTS.md
test -s CONTEXT.md
test -s docs/PLAN.md
test -s docs/features/v0.1/SPEC.md
test -s LICENSE
test "$(cat CLAUDE.md)" = '@AGENTS.md'
printf '%s\n' 'Planning scaffold checked; no application tests exist until M0.'
