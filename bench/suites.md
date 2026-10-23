# Suite and CI wall clocks

CI times every step of the gate: its shell is
`deno run -A bench/run.ts command --ci …` (below), and each step is a suite in
[@yaks/benchmark](../packages/benchmark/README.md). Timing is **report-only**:
the `benchmark:` line closing a step says its verdict (`REGRESSED` for a
regression), and never turns it into a failing test or a deployment veto.
`deno task test` and `deno task check` time nothing themselves: a test run
starts no other process (M-132169).

A suite named `NAME` writes `bench/suite-<URL-encoded-name>.results.json` and
checks a committed `bench/suite-<URL-encoded-name>.baseline.json` when there is
one. A result keeps the raw wall seconds, mean control seconds, control sample
count, timestamp, command exit code and ratio alongside the runner's metadata.
The committed baseline supplies the 25% tolerance. Recording and checking never
change it; `SUITE_ACCEPT=1` banks a reviewed measurement. Failed commands and
loaded runs cannot be accepted. A command without a baseline writes its
measurement without comparing it.

## Load compensation

A separate worker warms a fixed 8-million-step dependent LCG, then samples it
once per second throughout the command. The ratio is wall seconds divided by
mean control seconds. Thus a suite and control both taking twice as long have
the same ratio. The worker consumes roughly 40 ms of one CPU per second at idle;
this is part of the measurement protocol, not a benchmark of the application. No
control sample is taken from application code. Short commands use at least one
sample.

A control above 1.5x its baseline's stored control floor marks a loaded run.
Regressions still report, but acceptance refuses. Failed commands retain their
observations and exit status and never establish a floor. Changing the control
or sampling protocol must bump `VERSION` in `bench/suite.ts`, so an incompatible
measurement cannot silently compare against a banked workload.

This cancels approximately uniform CPU contention, not network delays, cold
caches, I/O contention, or changes in a parallel suite's CPU saturation. The 25%
band is a starting noise allowance, not a claim that a CPU reference perfectly
models every suite. Investigate repeated regressions before accepting them. Keep
cold CI suites separate from local suites; do not compare seconds across the two
environments.

For a per-step investigation and a repeated-body write regression fixed without
changing the timing threshold, see [check regression T-37417](check-37417.md).
For the fleet suite’s per-file profile, fixture fixes and independent-process
runner, see [fleet suite T-37421](test-37421.md).

## CI

The command boundary is
`deno run -A bench/run.ts command NAME COMMAND [ARGS...]`. The CI shell uses
`command --ci`, with `SUITE_STEP` supplying its step name.

The gate's custom shell times every executed **run step**, including path
detection, deploy recording, tests, and performance reports. Each has a stable
`ci/<step name>` suite. Skipped steps produce no new measurement. The checkout
and artifact-upload Actions are not shell commands and are not timed by this
wrapper; their wall clocks remain in GitHub's job timeline. The job summary
receives each timing report, and an `always()` artifact step retains results
even after a failure. No extra paid runner, API credential, or deployment
dependency is added. A `command` run inside a CI step is prefixed `ci/suite/`.
The artifact includes the per-suite result files. Bank reviewed CI floors with
`SUITE_ACCEPT=1`; until a CI step has a committed baseline, it records without
comparison.

Long command names use a shortened filename with a digest; the JSON keeps the
complete suite name, so distinct narrowed commands retain distinct results.

## Relay admission boundary (T-125978)

`relay/store/entities-*` measures **one value**, from WebSocket submission
through admission and staging, on a warmed Store. The simulated clock stays
fixed through that work. A controlled 16 ms timer registration queues the
endpoint microtask: admission has completed and the registering call stack has
filled the pending batch. Only afterward does the fixture flush fanout and
verify the observer got exactly that value. A skipped or refused value fails
instead of becoming a cheap sample. SQL counts cover the same interval. The
benchmark runs in isolation and restores its clock and timer overrides even on
failure.

The former synchronous loop stopped at `await #ensureStarted()`, before
admission. `24ef8e577e7d` moved decoding before that await for clock probes,
exposing the wrong boundary rather than making admission three times slower.
Workload `1/relay-staging-2` replaces only the relay timing and transaction
references with measurements of the corrected fixture on that commit's parent,
`77ebf5d382`. It is not acceptance of slower current-main observations:
tolerances and unrelated references stay unchanged. `relay-admission` uses the
same boundary (workload 2); its direct graph-check references remain unchanged.

`relay-staging.results.json` preserves the alternating seven-run parent/main
comparison and four repeated standalone comparisons. To reproduce the throughput
comparison, copy `bench/relay-fixture.ts` and `bench/relay_bench.ts` unchanged
into a detached worktree at `24ef8e577^`, then alternate this command between it
and main (hold the shared lock; never remove its file):

```sh
flock /tmp/yaks-throughput-bench.lock deno bench -A --no-check --json \
  --filter '/^relay\/store\/entities-(1|10|100)$/' bench/relay_bench.ts
```

Each report's average is already ns/value (one value/op); take each name's
median across seven invocations. Standalone comparisons use the current fixture
against either checkout root:

```sh
flock /tmp/yaks-throughput-bench.lock deno run -A bench/standalone-worker.ts \
  bench/relay-admission.ts /absolute/path/to/checkout
```
