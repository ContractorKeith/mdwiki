#!/usr/bin/env bash
# Shared local/CI gate; npm ci is a separate prerequisite.
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 26 || minor < 13) {
    throw new Error("mdwiki requires Node >=26.13.0 <27; use .nvmrc");
  }
'
npm run typecheck
npm run lint
npm run build
npm test
npm run test:installed
