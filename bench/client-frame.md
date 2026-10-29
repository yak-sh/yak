# Client frame measurement

A **frame sample** is one call to `frameFixture().frame()` in
`packages/client/frame_bench.ts`: all 208 bundles, three reads and forty live
watches in a 50,008-entity world. The sample includes bundle construction,
`client.mutate`, graph application, query evaluation and synchronous watch
notifications. World construction, warmup, final verification and disposal are
outside the sample. No network, persistence or rendering is measured.

The [retained report](client-frame-report.json) records the baseline SHA,
candidate source hashes, runtime, input manifest and raw nanoseconds per frame.
Three fresh worlds each warm for 100 frames, then produce 300 individual
samples. The primary pair measures the candidate before the baseline. Both use
identical benchmark code; the baseline checkout retains its original graph and
RAM sources. No benchmark budget is raised.

## Reproduce

```sh
deno run -A packages/client/frame_bench.ts --distribution
deno run -A packages/client/frame_bench.ts --distribution --batch
deno run -A packages/client/frame_bench.ts --distribution --alone
deno task bench:check client-frame
```

The default shape preserves the game's three writes: one local player, seven
peers in one batch, and two hundred creatures in one batch. `--batch` combines
those 208 bundles into one write; `--alone` writes each separately. Both
preserve the three reads and forty watches. These are optional shapes of the
same fixture, not additional registered benchmarks or additional budgets.

The world and moving set are bounded. Positions wrap at the world's edge and
health cycles; writes are not repeated noops. Final verification checks the
stored positions of all 2,008 movers and the fixed entity count.

Frame measurements run in Deno in process. Chrome is removed from this box; the
retained Chrome results below are historical measurements, not a workflow to
reproduce here.

## Reading the result

Primary pooled distributions, milliseconds per whole frame (900 samples each):

| Runtime | Source    | Median |   p95 |   p99 |    Max |
| ------- | --------- | -----: | ----: | ----: | -----: |
| Deno    | Baseline  |  2.930 | 4.813 | 5.705 |  7.288 |
| Deno    | Candidate |  2.820 | 4.207 | 4.936 |  6.108 |
| Chrome  | Baseline  |  3.300 | 4.700 | 5.700 | 17.400 |
| Chrome  | Candidate |  3.000 | 4.600 | 5.100 |  5.900 |

The candidate's primary medians leave over twelve milliseconds of a 16 ms frame
for the rest of the game. Separate-write Deno medians are 10.451 → 9.452 ms. The
one-batch Deno pair is 2.831 → 3.169 ms: it does not establish an improvement.
These optional shapes and repeated primary runs are retained rather than hidden.

The box is shared. Repeated samples include scheduling and garbage-collection
outliers, including an earlier candidate browser maximum of 98.1 ms. Neither a
maximum nor a small median difference is evidence of a hard-real-time guarantee.
The root optimization avoids work RAM does not need; these measurements show its
whole-frame effect without attributing every tail to that optimization.

## Why this is the game's shape

Mossvale's `apps/vale/play.ts` gathers position, motion and changing combat
state into a bundle list. Its `placed()` writes position and motion;
`net.move()` in `apps/vale/net.ts` sends the list through `client.mutate`.
Holdfast's `apps/holdfast/main.ts` calls `step(..., 0.05)` and mutates the
returned batch; `apps/holdfast/rules.ts` updates each creep's `along`, `at` and
combat state. Both construct their client with an empty graph-plugin list. The
existing fixture mirrors moving-state writes and the read/watch work a page
keeps, instead of the fleet task corpus or its business plugins. Its one-player,
peer-batch and simulation-batch split also keeps the cost of separate
application visible.

## Validation

Candidate source commit: `8a36a1388`; baseline: `f85fe08c3`. RAM, graph and
client tests passed (429); a final RAM/client budget run passed 274 tests with
no budget violations. Type checking and lint passed. Existing tests exercise
computed adoption, visibility, unique/value/range indexes and rollback.

The existing standalone ratchet was also repeated without changing any limit. It
was **not green on this shared box**: the candidate first exceeded the
200-bundle, carried and alive part limits; its repeat exceeded alive only. The
baseline with the identical harness exceeded the 200-bundle and carried limits
too. Treat these as noisy measurements, not a passed performance gate; the
report's paired individual-frame distributions are the before/after evidence.

The RAM change resolves fixed storage/reference policy once per component, skips
unique-constraint scans when the vocabulary has no unique constraints, and
avoids constructing a matcher view for plain `get` calls that need neither
visibility nor derived values. Index maintenance and rollback still use the same
`put` path; graph admission and all registered hooks remain unchanged.

### Rebase and final same-window control

Landing rebased onto `c06467bba`, including binary storage support. The conflict
resolution preserves byte copying on writes and reads. The inconclusive
`Object.keys` loop experiment was then removed; final source is `25779cea0`. The
original Deno/Chrome table above measures the pre-rebase candidate only.

The final Deno control loads baseline and candidate in one process and
alternates them every frame (three fresh pairs, 100 warmup and 400 measured
frames each). Pooled median/p95/p99/max milliseconds: baseline
**3.772/6.367/8.790/15.510**, candidate **3.707/6.395/8.602/45.016**. Median
improvement is small; p95 is effectively unchanged and the scheduling/GC maximum
is worse. No tail improvement or hard bound is claimed. Raw final and
intermediate comparisons are retained in `postRebase` in the report. Final
RAM/graph/client tests passed **444**, types and lint passed. Repeated
post-rebase budget runs still showed pre-existing client/SQL cases just over 1
ms under load; no budget was raised. No graph write-path bypass was added.
