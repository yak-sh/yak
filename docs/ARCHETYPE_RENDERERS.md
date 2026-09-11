# Archetype renderer dispatch

`src/live_archetypes.ts` learns immutable, content-addressed descriptors on
**demand**, shared by browser and TUI. Neither host waits for a graph-wide
archetype subscription before mounting.

- The fleet `Ent` adapter offers the raw cache row's component **names**, never
  component bodies or Ent's derived fields. Only a set whose hash equals the
  authoritative `entity.archetype` can supply its descriptor. Partial
  projections and stale unions that fail this check cannot invent a descriptor.
- Unknown descriptors use a narrow reactive row read and same-turn batched
  `id=…&.fields=archetype.tables` subscriptions. The existing one-shot door owns
  timeout, error and release. Failed reads may retry on the next render; an
  authoritative empty result does not cause a fetch loop.
- Descriptor replies are hash-validated and retained as immutable content, even
  if the requesting view unmounted. Retirement, eviction and reconnect do not
  invalidate that content. New physical sets are learned when used, not eagerly
  downloaded for unrelated entities.
- Until an unknown descriptor arrives, `@yaks/render` retains its ordinary
  bundle matcher fallback. Its arrival wakes that descriptor's readers. No
  partial set is cached as the answer for the authoritative archetype ID.
  Malformed descriptor data is rejected at lookup (and diagnosed if received
  after unmount), rather than gating or hanging the whole application's boot.

The package caches presence-query answers per query, vocabulary and table set.
Value predicates and column controls retain ordinary matching; value predicates
now decline the shortcut **before** consulting a potentially lazy descriptor
lookup. Registration ordering, top-level clause scores, catch-all 0.5,
qualified-view traversal and `extend()` overlays are unchanged. Tests cover
bodyless projected bundles, hash-checked local sets, batched arrivals, unmount,
eviction, retirement, retry and malformed replies, plus every view over the
432-set fixture for web and TUI. See the fixture README for sampling provenance.

## Boot recovery — T-37402, September 11, 2026

Baseline: `b3ad9786`. Candidate code: `a368d7db`. Full final receipts and
exploratory summaries are in `ARCHETYPE_BOOT_CDP.json`; the updated
`bin/archetype-probe.ts` checks both wire quiet and the browser apply queue.

Three alternating before/after samples used independent scratch copies of the
same saved snapshot, fresh Chrome profiles, a 1440×1000 viewport, and isolated
server state. Effects ran in daemon mode; sync and embedding were off. CPU is
CDP task duration through the first-card polling checkpoint, not an exact paint
trace. Traffic is settled inbound WebSocket UTF-8 payload bytes, excluding HTTP.

| Metric                                 | Before (three samples)      | After (three samples)       |
| -------------------------------------- | --------------------------- | --------------------------- |
| First-card mount (ms)                  | 1,483 / 1,492 / 1,432       | 1,226 / 1,268 / 1,152       |
| CPU through first-card checkpoint (ms) | 945 / 899 / 904             | 765 / 764 / 737             |
| First contentful paint (ms)            | 956 / 1,004 / 940           | 412 / 448 / 360             |
| Settled received bytes                 | 797,793 / 799,052 / 800,679 | 633,635 / 635,262 / 636,889 |
| Distinct received IDs                  | 1,003 / 1,005 / 1,007       | 570 / 572 / 574             |
| Cards / browser exceptions             | 11 / 0 in all               | 11 / 0 in all               |

Mean first-card mount is **1,469 → 1,215 ms** (17.3% lower), below the 1,405 ms
target in all three final samples. Mean CPU is **916 → 755 ms** (17.5% lower).
Mean traffic is **799,175 → 635,262 B** (20.5% lower), and mean IDs **1,005 →
572** (433 fewer). Every final card had its `.Card_Scroll` container and there
were no loading indicators. TUI boot rendered the board and exited with `q`,
status 0.

This recovers the first-card regression and removes the unrelated descriptor
catalogue, **not** the entire gap to the historical 479,778 B / 297 IDs.
T-37383's own pre-archetype measurement was already 622,613 B / 549 IDs; this
change stays close to that payload while preserving projection-safe archetype
dispatch. Identity/clock-sensitive maintenance causes small drift between fresh
browser samples.

A projected **global** descriptor subscription was also tried: it saved only
about 18 KB and retained roughly 1,000 IDs, so it was not selected. Early lazy
iterations reduced traffic to about 638 KB / 572 IDs but timing was unstable
under high host load (around 11). The final-code samples above ran after load
subsided (around 6); both baseline and candidate became faster. The JSON retains
those earlier runs separately, so the environmental improvement is not passed
off as a code speedup. Local checks/tests did not run alongside final CDP.

Both required gates (`deno task check` and `DB_PATH=:memory: deno task test`)
were run. All scratch servers were reaped by their registered PIDs, and Chrome
profiles, scratch databases, isolated homes and the baseline worktree removed.
Final gate receipts and landed SHA are on T-37402.

## Historical measurement — T-37058

The following records the original global-subscription implementation, since
replaced by the demand-driven path above.

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
