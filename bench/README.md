# Bench suites

The repository's benchmarks run through
[@yaks/benchmark](../packages/benchmark/README.md), with one committed baseline
file per suite. `deno task bench` measures the throughput suite's storage reads
and patches, `graph.apply`, and warmed relay admission. `deno task bench:check`
takes fresh measurements and refuses metrics more than **20% higher** than
`bench/throughput.baseline.json`, including statement counts.
`deno task bench:ratchet` explicitly accepts a fresh baseline; review and commit
its diff. Runs retain raw samples, round medians, commit, runtime, CPU and load
average in `bench/throughput.results.json`.

Benches run separately from `deno task test` and `deno task check`. The fast
suite checks fixture correctness and the ratchet's comparison logic. The
[command wall clocks](suites.md), [platform deploy](deploys.md) and
[app deploy](app-deploys.md) use the same runner and ratchet with their own
baselines.

## Other suites

Select a suite with the same three commands:

```sh
deno task bench client-frame
deno task bench:check client-frame
deno task bench:ratchet client-frame
```

The suites are `client-frame`, `client-rules`, `harness-startup`,
`harness-streaming`, `harness-worker`, `harness-window`, `harness-switch`,
`graph-activity`, `session-status`, `web-client`, and `relay-admission`. Each
writes `bench/<suite>.results.json` and checks `bench/<suite>.baseline.json`. A
suite without a banked baseline can run; a check refuses until its baseline has
been explicitly accepted. Take that measurement on an idle box, then review and
commit its baseline. Do not bank numbers taken on a loaded box.

Arguments after `--` reach the selected suite. For example, compare relay
admission in a checkout over 200 ticks with:

```sh
deno task bench relay-admission -- /path/to/checkout 200
```

`bench/peer-capacity.ts` is a one-off populated-peer investigation for the Vale
app, including joins, simulated clients and four paced movement ticks. Its
capacity observations remain outside the ratchet; see
[populated peer capacity](peer-capacity.md). The apply profile and workerd
microtask probes below also remain separate from benchmark suites.

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

## Recording overhead

`deno task bench:check throughput -- --recording` compares unsubscribed applies
with a graph channel subscribed to `@yaks/timing`'s `summarize` and `sample`. It
measures the same edit/create, alone/batch, SQLite/RAM and 200/1,000-bundle
cases. The two modes run in separate Deno processes so recording cannot alter
the unsubscribed process’s JIT feedback. Process order alternates each round.
Each recording invocation groups five fresh fixture workloads into a finite
minute with a shared ordinary-sample quota and summary buffer. Two measured
invocations and one warmup preserve ten measured workloads and five warmups per
case. It buffers all completed events by minute and assembles root-first trees,
including SQL and both tracker flush phases. It samples every completed tree
with the default slow thresholds and a shared ordinary-sample quota, then
summarizes closed minutes. The finite minute is closed inside timing so summary
cost is included without waiting for the clock. No tracker writes run.

Use `--filter='-200|batch-1000'` after `--recording` to select a subset by
regular expression.

The comparison uses subset coverage against the throughput baseline: banked
unsubscribed cases still fail on regressions; unbanked subscribed cases make the
verdict `measured`. It writes `bench/apply-recording.results.json` and leaves
the baseline unchanged. The normal throughput check retains exact coverage. The
recording run takes the same box-wide lock and seven rounds.

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
deno task bench relay-admission -- /path/to/checkout 200
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
boundary need an explicit fresh baseline. `commit` records HEAD; uncommitted
source changes are included, so retain the diff when comparing revisions.
Inspect the raw samples and load averages when investigating a noisy result.

## Box-wide serialization

Throughput and standalone suites acquire an exclusive `flock` on
`/tmp/yaks-throughput-bench.lock`, shared across worktrees. The kernel releases
the lock when its process exits. Never delete the lock file: waiters retain its
inode.

Direct `deno bench` commands and tests bypass the lock. Profile/probe commands
should acquire the same lock. Serialization cannot guarantee that other programs
leave the CPU idle; inspect the run's load averages before accepting a baseline.

[Apply profiling](apply-profile.md) records the box composition's transaction
residual and create-scaling investigation.
[Workerd socket microtasks](workerd-microtasks.md) records a standalone
hibernation probe. These are separate from the fixed ratchet composition and
from the test suite.
