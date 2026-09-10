# Layer throughput ratchet

Before a refactor phase, run `deno task bench` in a quiet session worktree and
save `bench/results.json` outside the worktree (for example,
`cp bench/results.json /tmp/before.json`). After the change, run it again and
compare the `ns` maps: **lower ns/op is better**, ops/sec is `1e9 / ns`.
`deno task bench:check` always runs fresh measurements and fails if any bench is
more than **20% slower** than the committed `bench/baseline.json`
(`REGRESSION_THRESHOLD` in `bin/bench.ts`). It never changes the baseline. For
an intentional new reference, run `deno task bench:ratchet`, review the numbers
and commit the baseline with an explanation. This is explicit acceptance,
including any regressions, not an automatic lowering of the floor.

## What is measured

The shared fixture is `packages/sqlite/fixtures/fleet.ts`: seed `0x36756`, 2,048
tasks with documents, 128 claims, 384 completed tasks, and 4,064
requires/contains edges (6,113 entities including the session). Requires chains
are 64 tasks long, so the depth-16 and unbounded walks return genuinely
different sets (16 vs 63). FTS returns 64 documents; the status filter returns
1,536 tasks. Each benchmark file checks the exact expected eid set before
timing, rather than assuming that a compiler that became faster still returns
the right answer.

Every layer runs the same five reads and a transactional batch of 100 doc-title
changes in both `:memory:` and a fresh temporary **file** database. File mode
uses **WAL + synchronous=normal**, including real commits; setup/migrations, FTS
index creation, seed loading, correctness assertions, and cleanup are outside
timing. The file DB is not deserialized into RAM. `DB_PATH` is set before fleet
imports; no benchmark opens the operator's graph. Temporary files are closed and
removed at process unload. Linux runs use the system SQLite library by default.

| Layer    | Timed read boundary                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sqlite` | Execute precompiled membership SQL via the `@yaks/sqlite` driver, then `get()` to hydrate bundles; parse/lower excluded. |
| `sql`    | Lower an already-parsed AST with `@yaks/sql.compile`, execute, hydrate with the same `get()`.                            |
| `query`  | `@yaks/query` parse → lower → execute → hydrate, through `@yaks/sqlite.read`.                                            |
| `fleet`  | `src/query.ts.parseQuery` → `src/sql.ts.where` → `db.ts.matching`, including fleet hydration. No JS fallback is allowed. |

Package layers use the small fleet-shaped vocabulary and FTS/traversal
extensions; fleet uses its real, wider vocabulary, stamps, blob storage, indexes
and rules. Thus fleet cost includes application overhead, not just a parser tax.
All reads hydrate their selection; these are not counts masquerading as entity
reads. Package drivers prepare/finalize statements per call at all three levels;
fleet retains its production statement cache. SQL/query have no write parser of
their own: their `apply-100` benches intentionally use the same transactional
`@yaks/sqlite` patch path as the storage bench. Fleet uses the real
`db.ts.apply`, including journal and provenance. Batches alternate two values,
so all 100 cells actually change on every iteration without growing the entity
corpus or changing read memberships. Fleet's journal grows as it does in
production; each sample starts from a fresh database. One write op means **one
batch**, not one cell.

## Samples and comparison

`deno task bench` runs the four `*_bench.ts` files with `deno bench --json`,
three fresh processes per storage mode, sequentially. Results have all 48 names,
three ns/op samples per name, runtime/CPU/source-revision metadata, and the
median. Deno's JSON exposes an average but not p50: the metric is therefore
explicitly `median-of-3-deno-avg-ns`, **not** the per-iteration median. The JSON
`ns` map and console ns/op/ops/sec table use that median of independent run
averages. Allow a few minutes; don't run concurrently with test suites or other
heavy jobs. `revision` records HEAD at invocation; uncommitted source changes
are included in the measurement, so retain the diff alongside any before/after
results.

Missing/extra/renamed benches, failed runs, nonpositive/nonfinite timings, or
incomparable metric/workload/runtime/CPU metadata fail closed. An absent
baseline is an error for `bench:check`, not permission to bless the current
performance. Bump `WORKLOAD_VERSION` when changing the corpus, query shapes, or
timed boundary, and explicitly accept a new baseline. Hardware/load and
filesystem differences matter for absolute times: compare on the same box under
similar load, inspect the raw samples, and investigate a noisy failure instead
of repeatedly accepting it away. A runtime/CPU change also requires explicit
acceptance.

Benches are **not executed** by `deno task check` or the fast `deno task test`
tier; only the small fixture/ratchet correctness tests run there. The existing
hot-path ratio gate is independent: `bench:gate` / `bench:accept` now retain
their original numbers in `bench/hotpath.baseline.json`. Web performance is
unchanged. Neither existing gate is replaced by this throughput suite;
`bench:hotpaths` retains the old direct `deno bench -A src` entry point.

## Box-wide serialization

`bench`, `bench:check`, and `bench:ratchet` use `bin/bench.sh` to take an
exclusive `flock` on `${TMPDIR:-/tmp}/yaks-throughput-bench.lock` before
starting Deno. All sessions/worktrees on the box must use the same TMPDIR (the
default is `/tmp`). This requires Bash and util-linux `flock`. A second
invocation prints one waiting line with the holder's PID and waits up to 1,800
seconds, then fails without measuring if the lock is still busy. The PID can
briefly be unknown while the first holder records it. The kernel releases the
lock on process exit; stale PID text is harmless. Never delete the lock file,
even after a crash: doing so would let new runs bypass waiters on the old inode.

The runner prints the sample count and warns at measurement start if `ps` finds
other `deno bench` or `deno test` processes (with their PIDs). This is
best-effort, not a CPU-idleness guarantee: tests, direct `deno bench` calls,
other benchmark gates, and jobs started later do not acquire this lock. Keep the
box quiet. Calling `bin/bench.ts` directly also bypasses serialization; use the
tasks above for measurements.
