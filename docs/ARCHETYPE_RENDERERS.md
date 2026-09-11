# Archetype renderer dispatch

`src/live_archetypes.ts` holds one permanent `.archetype!` subscription. Both
browser and TUI `boot()` await its addressed reply before mounting. New sets
invalidate renderer subscribers; retired descriptors stay usable. Malformed
initial replies reject boot. The fleet registry supplies the immutable table
arrays to `@yaks/render`, and its `Ent` adapter projects bodies lazily.

The package caches presence-query answers per query, vocabulary and table set.
Value predicates and column controls retain ordinary matching, as do bundles
without a known descriptor. Registration ordering, top-level clause scores,
catch-all 0.5, qualified-view traversal and `extend()` overlays are unchanged.
Tests cover projected bundles that throw on any body access, descriptor arrival,
retirement, malformed replies, and every view over the 432-set fixture for web
and TUI. See the fixture README for its sampling provenance.

## CDP measurement — September 11, 2026

Baseline: `c856f55f`. Candidate: `08a3cc83` (subsequently rebased, without
changes to the measured web dispatch files). Full numeric results are in
`ARCHETYPE_RENDERER_CDP.json`; `bin/archetype-probe.ts` reproduces the
measurement against a caller-owned scratch server.

Both sides served from the session worktree, restoring committed files between
runs, using the same saved snapshot copied into a disposable database. Server
environment: explicit `DB_PATH`, `TASKS_HOME`, `HARNESS_HOME`, `PROCESS_DIR`,
`TASKS_EFFECTS=daemon`, sync off and embedding off. Chrome had a fresh profile
and `TMPDIR` for each sample, a unique debugging port, and a 1440×1000 viewport.
The source snapshot is private and is not a repository fixture.

The comparable pair on each side waits 15 seconds after the first card, then
waits for subscription traffic to settle. CPU is CDP `Performance.getMetrics` at
the first-card polling checkpoint (100 ms polling), not an exact paint CPU
trace. A mutation observer records the first card's mount time separately.

| Metric                                          | Before (two samples)  | After (two samples)   |
| ----------------------------------------------- | --------------------- | --------------------- |
| First card mount                                | 1,425 / 1,386 ms      | 1,857 / 1,741 ms      |
| CPU task duration through first-card checkpoint | 687 / 726 ms          | 901 / 898 ms          |
| Script duration at that checkpoint              | 60.7 / 69.0 ms        | 63.6 / 62.2 ms        |
| First contentful paint                          | 460 / 328 ms          | 1,136 / 1,108 ms      |
| Settled received WebSocket bytes                | 3,672,059 / 3,672,000 | 3,845,202 / 3,846,829 |
| Cards / browser exceptions                      | 11 / 0 in both        | 11 / 0 in both        |

The descriptor reply carried 445 sets and arrived at 849 / 801 ms, before card
mount. Mean received traffic increased by 173,986 bytes (4.7%). Mean first-card
time increased by 394 ms, and CPU through the checkpoint by 193 ms. This is a
measured boot cost, **not a demonstrated first-paint speedup**; the benefit is
dispatch from a spine-only projection with cached table-set matching. Script
time is essentially unchanged at this scale. Live-clock queries and new browser
client identities cause small count/byte differences between fresh samples.

An earlier exploratory pair used a shorter four-second settling period and had a
noisy 8.8-second baseline mount. It is retained separately in the JSON, not
mixed into the comparable table. A post-rebase smoke run verified all 11
`.Card_Scroll` containers, no loading indicators, and no runtime exceptions. The
TUI was also booted under tmux with an isolated HOME and the shared DENO_DIR; it
rendered the board and exited with `q`. Browser, terminal and scratch server
processes were reaped; profiles and scratch databases were removed.

## Gates

`deno task check`, `DB_PATH=:memory: deno task test`, and
`deno task bench:check` were run. The throughput check initially failed four
thresholds while local tests were competing with it; a repeat without local
tests/probes passed with the baseline unchanged. Final gate receipts and the
landed SHA are on T-37058.
