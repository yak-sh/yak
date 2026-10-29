# Bench suites

The repository's benchmarks run through
[@yaks/benchmark](../packages/benchmark/README.md), with one committed baseline
file per suite. `deno task bench` measures the throughput suite's storage reads
and patches, `graph.apply`, and warmed relay admission. `deno task bench:check`
takes fresh CPU measurements and refuses any figure past its slack over
`bench/throughput.baseline.json`. Statement counts are retained separately.
`deno task bench:ratchet` banks a baseline; review and commit its diff. Runs
retain raw samples, round medians, commit, runtime, CPU and load average in
`bench/throughput.results.json`.

## Banking a baseline

`bench:ratchet <suite>` measures the suite three times over (`--runs=<n>` for
another count) and banks each bench's best median, with the noise those runs
measured as its slack: twice the spread of every round median they took
(@yaks/benchmark's ratchet). `bench:check` measures the same way and compares
each bench's best median, so a check measures what its baseline banked;
`--runs=1` is a quicker, noisier look. A bench regressed when its figure is past
its median by more than the noise of both the baseline and the check. A baseline
moves only toward faster, and only by more than that noise, so a lucky run never
tightens it. Banking a slower one is a separate explicit operation (`--slower`),
not monitoring; `--slower=close,open` banks only the named benches as measured,
a cost chosen for one workload without accepting the others' figures.

Every timed sample records CPU through the shared `stopwatch()`, and repository
runs select `figure: 'cpu'`. Raw wall durations remain diagnostic. CPU includes
all user and system work in every thread and reaped child; collectors add an
external process counter or server-reported CPU for work in a process that stays
alive across samples. Missing CPU fails the measurement. CPU runs record load
averages without waiting for a quiet box or running a load-control worker.

To convert an existing suite's baseline to CPU, use
`deno run -A bench/rebank.ts <suite>`. It measures the baseline's product
revision beside current code under the same driver and banks only the reference
CPU readings, retaining any current regression in the evidence. Each bench keeps
its own reference commit; partial acceptance preserves the reference of every
retained median. Mixed baselines are compared in groups by reference. See
[baseline conversion](suites.md#baseline-conversion).

## The monitor

Nothing gates on a bench; bench/monitor.ts watches them instead, and a "got
slower" bug it files means the code got slower. It screens each suite with one
run against its committed baseline. A screen past its limit is never evidence by
itself: the monitor then measures the code the baseline was banked at beside the
code now, at the same moment ([side by side](#side-by-side-on-a-shared-box)),
and reports only the benches that comparison finds slower, with the commits
between the two. A busy box slows both alike, so it files nothing. Every
controlled suite is judged this way and none opts in.

A check that can tell nothing reports nothing and is owed to a later tick: a
busy benchmark lock, a measurement past its time cap, older code that cannot run
today's bench. A suite that fails (no baseline, a crash, a page that never
paints) is checked again at once and reported only when it fails again, so a bug
says the bench is broken. @yaks/heal sends a regression or a failure to an agent
like any other bug.

Cron runs it from the main checkout through bin/bench-monitor: every suite at
02:23, and user-facing suites every 30 minutes (`--hourly`). The user-facing
suites collect serially under the box-wide lock, so fixtures never measure one
another. The hourly lane holds a persistent queue in
`~/.cache/yak/bench/hourly-queue.json`, with one lane lock around loading,
checking and saving it. Each tick stops admitting work after 25 minutes; an
admitted screen keeps its ten-minute limit, and a comparison its half hour. A
busy box lock leaves the owed suite at the head of the queue and ends the tick;
a suite checked in the last hour is not owed again. It never starts parallel
collectors, extends measurement limits or interrupts another lock holder. The
monitor banks nothing: a baseline moves only by `bench:ratchet`.

## Page behavior

Chrome is removed from this box. The `pages`, `page-content` and `inbox-content`
suites and Chrome paint measurements are removed. Page behavior belongs in Deno
on a linkedom document, and terminal paint in @yaks/tui's `lay`; neither starts
a browser or server.

Benches run separately from `deno task test` and `deno task check`. The fast
suite checks fixture correctness and the ratchet's comparison logic. The
[command CPU timing](suites.md#command-timing) uses the same runner and ratchet.
[App deploy observations](app-deploys.md) remain diagnostic waits without a CPU
baseline comparison. yaks.app's own [deploy timing](deploys.md) is the deploy
catch-up's, outside the benches.

## Waiting paths

The [waiting-path inventory](waits.md) maps user-facing operations to their
timed boundaries. `person-commands` measures CLI spawn-to-exit, the prompt hook
over a one-MiB transcript, MCP responses and terminal paint/navigation over an
isolated 2,000-task SQLite graph. `platform-waits` measures management HTML, app
HTML, and connector tools over an isolated production kernel. `worker-health`
reads CPU of active worker cgroups, including all threads and children, without
signalling them. Its population and active work are uncontrolled, so the monitor
excludes it from regression comparisons. `deno task bench worker-health` reports
one live CPU-rate observation; `check` and `ratchet` also only report it.

## Other suites

Select a suite with the same three commands:

```sh
deno task bench client-frame
deno task bench:check client-frame
deno task bench:ratchet client-frame
```

The suites are `client-frame`, `client-rules`, `harness-startup`,
`harness-steps`, `harness-streaming`, `harness-worker`, `harness-window`,
`harness-switch`, `graph-activity`, `session-status`, `web-client`, and
`relay-admission`. Each writes `bench/<suite>.results.json` and checks
`bench/<suite>.baseline.json` (`harness-steps` shares its reference at
`packages/harness/steps.baseline.json` with the live overhead observer). A suite
without a banked baseline can run; a check refuses until its baseline has been
explicitly accepted; review and commit its baseline.

`harness-steps` measures native session overhead with an instantly answered
scripted model on an isolated in-memory harness graph. `no-tools` is one
input-to-final-reply turn in milliseconds; `tool-step` is input-to-final-reply
CPU time divided by 12 completed sequential tool steps, in milliseconds per
step. The latter includes all model turns (13 result-driven turns and at most
one pending-progress turn per tool), async `session_tool` effect dispatch,
tool-result persistence, fixed-reference overhead observation and the
unfinished-work check (with no external reporter), not model/network/tool I/O.
Each metric has one discarded warmup and three measured rounds with fresh
graphs. Runner completion is awaited directly; the CLI revision-polling wait is
not timed. Fresh-session creation and the first ask are timed (there is no seed
turn subtracted). Composition, count/output verification, effect drain and
cleanup are untimed. Every round verifies the final reply, exact
model/tool/result counts, async calls, progress entries, and retained
input/results. No managed runs, live database, database copy or external model
is used.

Run through the ratchet without banking a baseline:

```sh
deno task bench harness-steps
# Direct measure, bypassing the ratchet and its box-wide lock:
deno run -A bench/standalone-worker.ts packages/harness/steps_bench.ts
```

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
and archetype pointers after timing. The collector takes exactly ten measured
iterations and five warmup iterations per apply case. SQLite writes use ordinary
commits; there is no enclosing rollback transaction. A file sample starts on a
WAL checkpointed during warmup, so a checkpoint of setup's own pages never lands
in its timed apply.

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

The throughput runner takes seven collection rounds per case, sequentially, and
records their median, raw samples, runtime, CPU, source revision, units and
Linux load averages. Collector processes retain warmed product imports across
rounds; each collection creates and disposes fresh fixtures. The shared Deno
collector measures CPU for batches of registered workloads, honoring their
explicit timing boundaries. Authored `n` and `warmup` counts are honored
exactly. Without `n`, calibration uses whole-invocation CPU, including fixture
cost. Each collection reports one measured batch average with CPU retained in
`details.cpuSamples`; paired rounds supply the repeated observations. These are
batch averages, not per-invocation medians. The result metric carries `/cpu`.
Storage modes run in separate processes, followed by the graph/relay cases.

Missing or renamed cases, failed runs, invalid timings or counts, and different
runtime/CPU/workload metadata fail closed. Changes to a workload or timed
boundary need an explicit fresh baseline. `commit` records HEAD; uncommitted
source changes are included, so retain the diff when comparing revisions.
Inspect raw CPU samples, round spread and paired reference measurements when
investigating a noisy result.

## Box bench

`bench/box.ts` measures where time goes when agents use a box's own graph: the
`yak` commands they run, the phases of one command, the rows a read and a write
add, `apply()`, and the effect pool. It runs against a **copy**: a database and
config made from the box's, never the files under `~/.yak`, which it refuses.
Each run can first reset the copy from a **snapshot**, a read-only backup of the
box's database, so every run starts from the same bytes:

```sh
sqlite3 -readonly ~/.yak/yak.db ".backup $HOME/.cache/yak-bench/base.db"
# yak.json there: ~/.yak/yak.json with `db` naming the copy, its own `port`
# and `hostname`, and `tracker.spool` and @yaks/spawn's `worktrees` beside it
deno task bench box -- --config ~/.cache/yak-bench/yak.json \
  --base ~/.cache/yak-bench/base.db
```

Copying a 10 GB snapshot takes minutes; without `--base` the copy keeps what
earlier runs wrote. Local children run this checkout's code without network
permission and with no session, token or other graph in their environment; the
CLI serves no effects, and the in-process pool runs a no-op for every declared
effect. The suite's sections, each one selectable with `--only`:

| Section   | Benches                                                                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli`     | Wall time of each command from spawn to exit, with its CPU time. `deno` is an empty module.                                                                                                                                                                                                           |
| `startup` | One help, read and write each, timed from inside by `box-probe.ts`: `boot` (runtime start and module graph load), `import`, `commands` (every plugin's vocabulary), `compose`, `tool`, `close` and `exit`; and `compose()`'s own named phases.                                                        |
| `rows`    | The entity, journal change and effect rows one read and one write add.                                                                                                                                                                                                                                |
| `graph`   | `box-graph.ts`: `apply()` of 1 to 1,000 comments with its time split by plugin, phase and SQL; the run a comment edit owes, owed, claimed, run and settled; an unbounded pass draining the runs 25 edits owe; and one pass over 0, 1k and 100k pending rows, made in a transaction rolled back after. |
| `db`      | Not run unless named: size by table (it reads every page), entities by archetype, effect rows, journal changes a day.                                                                                                                                                                                 |
| `door`    | An explicit HTTP door: read/write command wall and CPU time, the server's observed tools/call handler and span tree, cached roster reads, and client startup phases. Requires `--door-port`.                                                                                                          |

A round runs every section; `--rounds` (3) and `--runs` (7 per command a round)
set the sample counts. The table it prints gives each bench's p50 and p95.
Results go to `bench/box.results.json`, and `bench:ratchet box` banks
`bench/box.baseline.json` for `bench:check box`. CPU determines the timing
comparison; wall durations and load averages remain diagnostic.

To measure the explicit HTTP door alone, give it an unused scratch port:

```sh
deno task bench box -- --config ~/.cache/yak-bench/yak.json \
  --only door --door-port 5198 --rounds 3 --runs 7
```

`--door-port` also adds `door` to the default sections. The harness refuses port
5173 and occupied ports. It serves the supplied scratch graph through this
checkout's composed API handler with duties disabled, using a temporary server
config and client cache. Door children have network permission only for that
loopback port. The harness stops its server and removes its temporary state in
`finally`; the supplied scratch graph retains its benchmark rows as local
sections do.

The read is `yak --host 127.0.0.1:<port> task list --limit 5`; the write is
`comment new` on a dedicated target, with a unique body per sample. Setup seeds
five tasks and a person/session pair, checks that the read returns five tasks,
and verifies each saved comment's `created.by` and `created.via` outside timing.
Each round warms both commands once before `--runs` measured invocations. Their
normal text output is included in spawn-to-exit wall time.

`door-startup` runs a separate observed command per workload per round. `boot`
uses absolute clocks from the parent and child; `import` times loading the CLI,
`setup` reaches its command-list request, `list` includes the warm roster lookup
and command construction, and `dispatch` reaches the selected command. `request`
includes credentials, transport and response decoding for every RPC during the
command; `render` is the command interval less those requests. `preparation` is
the measured time from entering an RPC to entering fetch, a subset of `request`
that includes credential lookup and RPC setup. It is not a separate additive
phase or a credential-only measurement. `close` and `exit` finish the command.
`door/cache` separately times `cached()` on the warm roster in the benchmark
process; it is not subtracted from client startup.

Server samples measure the selected tools/call from entering the composed API
handler to its response, excluding body inspection and writing the observer's
records. Those observer costs remain in command wall time. Span collection runs
only on this scratch server. Client phases and server samples use separate
invocations and overlapping clock ranges; they are diagnostic measurements, not
an additive breakdown of the command wall sample.

## Effect worker writes

`bench/worker-apply.ts` measures the writes a warm effect worker makes, on the
same copy and config: the host is composed once, a pool worker stays up over it
with a no-op handler for every declared effect, and nothing is opened per write.
It prints the median owing commit, claim and settle, one run's life from the
commit that owes it to its settle, each of those writes split by phase with its
statements and rows, and the runs a second the worker settles from a backlog
written through the graph:

```sh
deno run -A bench/worker-apply.ts ~/.cache/yak-bench/yak.json 25 20000
# the drain alone, under a profiler: write the backlog, then drain it
deno run -A bench/worker-apply.ts ~/.cache/yak-bench/yak.json 0 20000
deno run -A --cpu-prof bench/worker-apply.ts ~/.cache/yak-bench/yak.json 1 0
```

## Box-wide serialization

Throughput and standalone suites acquire an exclusive `flock` on
`/tmp/yaks-throughput-bench.lock`, shared across worktrees. The kernel releases
the lock when its process exits. Never delete the lock file: waiters retain its
inode.

Direct `deno bench` commands and tests bypass the lock. Profile/probe commands
should acquire the same lock. Serialization prevents benchmark fixtures from
measuring each other. CPU samples and paired measurements provide the evidence
for baseline changes.

[Apply profiling](apply-profile.md) records the box composition's transaction
residual and create-scaling investigation.

### Side by side on a shared box

bench/paired.ts groups benchmarks by the reference commit of their banked
median, then measures each group at that revision and HEAD under the same
driver: this checkout's bench files and @yaks/benchmark, copied into an archive
of each revision. It holds the box-wide lock across one unmeasured run of each,
so no round times one tree's cold compile caches against the other's warm ones.
Separate collectors keep the before, current and after sequences equally warm
through rounds of reference, current, reference (at least six, more with more
benches, for the within-round sign comparison); each probe owns its seeded graph
and no live database is copied. A bench is slower when every round's current
figure is past both references beside it (or every current figure past every
reference one) and its median is past the reference's by more than the slack its
baseline banked. The figure is CPU time in every suite (@yaks/benchmark
`stopwatch`); missing CPU never falls back to wall time. Collectors include CPU
from long-lived processes through external counters or server reports. Other
work on the box during the bracket is recorded; reference rounds that drift
apart make the whole comparison inconclusive. So does older code that cannot run
today's driver; a failure of the current code's bench is a failure. The
comparison banks nothing.

To inspect one directly while holding the shared measurement lock:

```sh
flock /tmp/yaks-throughput-bench.lock deno run -A bench/paired.ts \
  hook-waits /tmp/hook-paired.json [--reference=REV] [--current=REV]
```
