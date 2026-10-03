# Throughput ratchet

`deno task bench` measures storage reads and patches, `graph.apply`, and warmed
relay admission. `deno task bench:check` takes fresh measurements and refuses
metrics more than **20% higher** than `bench/baseline.json`. It checks statement
counts as well as elapsed time. `deno task bench:ratchet` explicitly accepts a
fresh baseline; review and commit its diff. Measurements and metadata are also
written to `bench/results.json`.

Benches run separately from `deno task test` and `deno task check`. The fast
suite only checks fixture correctness and the ratchet's comparison logic.

## Fleet corpus and storage

The deterministic corpus in `packages/sqlite/fixtures/fleet.ts` has seed
`0x36756`, 2,048 tasks, 128 claims, 384 completed tasks, and 4,064
requires/contains edges: 6,113 entities including the session. Dependency chains
are 64 tasks long. FTS selects 64 documents; the open-status filter selects
1,536 tasks. Each storage bench checks its expected eid set before timing.

The `sqlite`, `sql` and `query` layers measure five hydrated reads and a
transactional batch of 100 changed titles, in memory and in a fresh SQLite file.
The SQLite layer executes precompiled membership SQL; SQL lowers a parsed AST;
query includes parsing. All three use the same prepare-per-call driver and small
fleet-shaped vocabulary. The `archetype` cases measure backfill and 100
archetype moves. Setup, seed loading, assertions and cleanup are outside timing.
Files use WAL and `synchronous=normal`; timed writes commit to the file.

## Graph apply

`bench/apply_bench.ts` compares N separate one-bundle applies with one apply of
N bundles, for edits and creates at N=200 and N=1,000, on a SQLite file and
`@yaks/ram`. It reuses the fleet corpus with production vocabulary documents
from kernel, doc, edge, task, session, tools, model, context, archetype and
effects. The graph uses the production kernel, doc, edge, task, session,
archetype and effects plugins, including declared task rules and core stamps.
SQLite additionally records the journal and uses the production cached driver.
Both adapters number entities. This fixed composition is independent of the
operator's config; it does not include blob storage or FTS indexing.

A sample owns a freshly seeded store. The seed is created once through this
graph, then copied through storage outside timing, including its stamps and
archetype descriptors. The graph is warmed before measuring. Every edited entity
already exists; every created entity is absent. Creates cannot turn into edits
or grow the corpus across samples. Each sample verifies the saved titles, stamps
and archetype pointers after timing. Deno takes at least ten measured iterations
and five warmup iterations per apply case. SQLite writes use ordinary commits;
there is no enclosing rollback transaction.

The ratchet divides each Deno operation by N and records **ns/bundle**,
displayed as **µs/bundle**. `counts` reports SQL statements per apply and per
bundle, including BEGIN/COMMIT, post-commit reads and the cached driver's
internal schema-version probes. Native statement executions are counted in a
separate process so the observer adds no timing overhead. RAM has zero SQL
statements. `deno run -A bench/apply-fixture.ts` independently verifies these
counts.

## Relay admission

`bench/relay_bench.ts` reuses T-64601's fixture retained by T-64638:
authenticated sockets relaying ordinary admitted presence values on a warmed
Store backed by Durable SQLite, at 1, 10 and 100 entities. A Deno operation
sends ten simulated 100ms turns; the ratchet divides by ten times the entity
count to record **ns/value**, displayed as **µs/value**. Two warm values
exercise restored sinks and the held peer overlay before timing. Setup,
observers, timer-driven fanout and cleanup are outside timing. Message admission
completes synchronously; its returned delivery promise represents the excluded
fanout.

`counts` reports SQL statements, reads, writes and transactions per value.
`deno run -A bench/relay-fixture.ts --counts` verifies them independently. The
comparative CLI remains available:

```sh
deno run -A bench/relay-admission.ts /path/to/checkout 200
```

It reports relay and ordinary `graph.apply(check)` costs from three rounds at
each entity count. A checkout argument permits comparing the same fixture across
revisions. The warmed relay ratchet covers admission/coalescing rather than a
socket round trip or fanout to observers.

## Samples and comparison

The runner takes seven independent Deno process averages per case, sequentially,
and records their median, raw samples, runtime, CPU, source revision, units and
Linux load-average samples. Deno's JSON exposes an average; the metric is
`median-of-7-deno-avg-ns`, not the per-iteration median. The storage modes run
in separate processes, followed by the graph/relay cases. Allow several minutes.

Missing or renamed cases, failed runs, invalid timings or counts, and different
runtime/CPU/workload metadata fail closed. Changes to a workload or timed
boundary need an explicit fresh baseline. `revision` records HEAD; uncommitted
source changes are included, so retain the diff when comparing revisions.
Inspect the raw samples and load averages when investigating a noisy result.

## Box-wide serialization

The three tasks use `bin/bench.sh` to acquire an exclusive `flock` on
`${TMPDIR:-/tmp}/yaks-throughput-bench.lock`. Use the same TMPDIR across
worktrees. A second invocation reports the holder's PID and waits up to 1,800
seconds. The kernel releases the lock when its process exits. Never delete the
lock file: waiters retain its inode.

The runner warns if it finds other Deno bench/test processes at startup. This is
not a CPU-idleness guarantee: direct bench commands and tests bypass the lock.
Profile/probe commands should acquire the same lock. Calling `bin/bench.ts`
directly also bypasses it.

[Apply profiling](apply-profile.md) records the box composition's transaction
residual and create-scaling investigation.
[Workerd socket microtasks](workerd-microtasks.md) records a standalone
hibernation probe. These are separate from the fixed ratchet composition and
from the test suite.
