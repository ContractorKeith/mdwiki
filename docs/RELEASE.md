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

## Issue #20: intermittent installed MCP diagnostic

The failed macOS main run [41511121923, job 125502910143](https://github.com/ContractorKeith/mdwiki/actions/runs/41511121923/job/125502910143)
at `623154465785fa9fe5e1e8f5dcd42a853aa22004` completed all workflow tool calls,
including a clean three-note full rebuild and final read. Its installed example
then failed the exact empty-stderr assertion on a generic `INDEX_DEGRADED` line.
The log contains no per-note diagnostic for that background pass, so its precise
origin cannot be recovered. Earlier green PR #19 evidence remains valid for that
head; it does not resolve this later failure.

A deterministic Linux fixture reproduces the same diagnostic followed by a clean
response: open the old note inode, publish a replacement through the real mutation
operation, then resume the index read. The boundary check correctly raises
`CONFLICT`; previously the index immediately excluded the note and emitted a
transient degraded event before the watcher's dirty-pass reconciliation recovered.
This is a supported cause consistent with the CI symptom, not proof of the original
macOS interleaving or a persistent corrupt index.

Index reads now retry a `CONFLICT` once through all existing path and bounded-read
checks. A second conflict still excludes stale data and reports diagnostics;
permission, encoding, size, path and frontmatter failures keep their diagnostics.
The regression fails before the fix specifically on the unwanted degraded event,
then passes with current search data and a clean full rebuild. A separate repeated
atomic-replacement fixture proves the two-attempt bound, stale-content exclusion,
visible conflict diagnostic and recovery. Existing unreadable-note checks remain.
The shipped MCP example retains exact empty stderr, requires clean structured
results, and verifies all three notes plus search/backlinks after a fresh rebuild.

Use the source/installed gate and unchanged benchmark to verify this runtime change.
Local evidence is Omarchy Linux, Node v26.13.0/npm 11.20.0, with owned `/home`
btrfs TMPDIR and explicit npm cache/config/prefix; shared `/tmp` has quota limits.
No local macOS verification is claimed. Final-head Linux/macOS CI and parent release
verification are still required; no tag or publication is authorized by this fix.

The local fix gate passed `npm ci`, typecheck, lint, build, all 72 source and 72
fresh-installed tests (all previous 70 retained), and `git diff --check`.
The unchanged serial benchmark stayed within its original budgets; actual timings
and measurement limits are recorded in [BENCHMARK.md](BENCHMARK.md#issue-20-index-read-retry-verification).

## v0.1.0 candidate integration

Issue #20 was addressed in PR #21, merged as `225b4db` with a tree identical to
`8de4626`. Parent full-diff review, 72 source + 72 installed tests and all exact-head
Linux/macOS jobs passed. Persistent conflict diagnostics remain visible; the original
macOS interleaving cannot be recovered from its generic log.

Parent benchmark investigation retained all results: initial fixed cold/unchanged/
search 25452/23016/16599 ms under host load 17.04 on 16 logical CPUs; pre-fix comparison
12819/30843/22870 ms also exceeded budgets. Fixed repeat 15538/12073/11533 ms met
all budgets; peak RSS 132.9/103.2/103.4 MiB. Same 10k fixture, Node 26.13.0/npm 11.20.0,
owned btrfs scratch; all results correct and scratch cleaned. These runs do not
isolate code effects or prove timing equivalence. No specific regression established.

This candidate adds the versioned changelog and ships it in the tarball. Run the
complete gate on this commit and require both-platform CI before tagging. Retain
the final tarball/checksum with the GitHub release. Tag/release URLs and npm status
are external records; their absence must not be interpreted as publication.
The configured npm client returned ENEEDAUTH on 2026-11-03; authenticated access and
name claimability still must be established before registry publication. A GitHub
tarball release can be installed independently of npm registry publication.
