# v0.1 release checklist

A tested tarball is not a published registry package. M6 produces an artifact and
reviewable evidence; the parent owns readiness, merge, publication and tags.

1. Pin base/head SHA and inspect `git diff BASE...HEAD` for standards and full spec
   compliance. Verify the [acceptance mapping](ACCEPTANCE.md) against real assertions.
   Fix confirmed defects with bounded deterministic regressions; rerun relevant gate.
2. On Linux and macOS, use Node 26.13.0/npm 11.20.0, owned workspace mkdtemp scratch,
   explicit TMPDIR and npm cache/config/prefix. Never use real vaults or change HOME.
   Run `npm ci`, then `bash scripts/accept.sh`. The source and fresh installed suites
   include lazy startup/preview snapshots, successful publication despite indexing
   failure, stable live coordinators, exact physical paths and initialized MCP.
3. Retain artifact evidence by setting `MDWIKI_ARTIFACT_DIR=/absolute/owned/artifacts`
   before the gate. It copies the successfully installed tarball and writes
   `artifact.json` with SHA-256, npm manifest, actual installed dependency versions/
   licenses, size, runtime/platform and suite result. Application exercises exclude user/global npm binary paths.
   Save full gate output separately. Never commit generated tarballs, prefixes or
   caches. Recompute `sha256sum ARTIFACT` (macOS: `shasum -a 256 ARTIFACT`). A hash
   cannot live inside the tarball it hashes; record it in handoff/PR evidence.
4. Inspect `tar -tzf ARTIFACT` and artifact.json: compiled executable, package
   metadata, MIT license, operational/spec docs and runnable examples must ship.
   Source tests, scratch, private payloads and node_modules must not ship. Verify
   executable permission after npm prefix install. No hidden global runtime tools.
5. Run `npm run benchmark` **serially after the gate**, unchanged fixture/script/
   budgets. Record hardware, filesystem, cold/unchanged/search/RSS and comparison
   limits in BENCHMARK.md. Investigate budget overruns; never add CI timing assertions.
6. Review DEPENDENCIES.json against the lockfile (gate checks exact equality), direct
   dependency rationale/licenses in DEVELOPMENT.md and `npm audit --omit=dev` plus
   full `npm audit --json`. Record actual advisories; no forced incompatible fixes.
   Runtime dependency copies retain their upstream license files via npm install.
7. Query actual configured registry read-only (`npm view mdwiki ...`, `npm whoami`)
   with owned empty npm configs; do not inspect credential files or print tokens.
   404/unpublished does not establish name claimability. Authentication under this
   isolated configuration says nothing about credentials stored elsewhere. Verify
   publisher access/name with registry support/authorized credentials separately
   before any publication. Keep executable name mdwiki if package naming changes.
8. Require **actual green ubuntu-latest and macos-latest CI jobs at the final SHA**.
   Local Linux checks are not macOS evidence. Parent repeats artifact verification
   on both platforms, records final review and constraints, then decides release.

Current constraints: package registry query reports unpublished/404; isolated
whoami reports ENEEDAUTH. No claim of name ownership, publication or release tag.
The full development audit has 11 moderate minimatch-chain findings (see DEVELOPMENT).
No graph-heavy, watch-scale or mutation-throughput benchmark exists. Network/virtual
watch reliability and the uncoordinated-editor publication race remain documented
limits. Local M6 results are recorded in BENCHMARK.md and the draft PR; CI and parent
review remain independent release gates.
