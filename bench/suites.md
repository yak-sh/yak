# Suite CPU timing

Repository benchmark suites judge CPU time through
[@yaks/benchmark](../packages/benchmark/README.md#cpu-time). Every timed sample
keeps CPU usage alongside its wall duration. The runner selects `figure: 'cpu'`
and the monitor's paired comparison requires CPU in every round; neither falls
back to wall time. SQL statement and row counts remain separate measurements.

`bench/deno-worker.ts` collects existing `Deno.bench` declarations with the
shared CPU clock. It warms each workload, measures batches, and reports CPU and
wall averages in ns/op. Explicit `start()` and `end()` boundaries exclude
fixture setup and teardown. The workload files need no separate CPU
instrumentation.

## Process accounting

The shared `stopwatch()` reads `cputime()`: getrusage(2) user and system time
for every thread in the process, plus children that have exited and been waited
for. Waiting for a timer, I/O or a CPU adds no CPU time. A subprocess that exits
inside the measured interval contributes its work through its parent's child
usage.

A process that stays alive across samples needs its own counter. A server can
report its own CPU at the measured boundaries; a collector can pass synchronous
counters to `stopwatch(...sources)`. Linux `processCpu(pid)` reads an external
process tree's live threads and reaped children. Keep an observed process alive
across both readings, and avoid adding a counter for CPU already included by
another counter.

App deployment observations (`app-deploy`) measure network and deployment waits
without server CPU accounting. They remain diagnostic observations in `run`
mode, with no baseline comparison. Timer-lag observations likewise describe
waiting rather than CPU work.

## Baseline conversion

A CPU baseline measures the product revision named by the existing baseline,
using the current driver. Run the conversion for selected registered suites:

```sh
deno run -A bench/rebank.ts throughput relay-admission
```

The conversion holds `/tmp/yaks-throughput-bench.lock` and uses the same paired
collector as the monitor: warm both revisions, then alternate reference,
current, reference measurements. Both revisions use identical benchmark files
and the shared CPU clock over their own product code. Each probe owns its
fixture; no live graph is copied.

Only the reference readings are banked. Their spread supplies the baseline's
slack, and `reference` retains the measured product commit. A slower current
reading stays visible in the comparison rather than becoming the CPU baseline.
An inconclusive comparison or failed workload banks nothing.
`bench/<suite>.rebank.results.json` retains the evidence and
`bench/cpu-baselines.json` records each suite's reference, current revision,
verdict and figures. Commit the baseline changes and retained evidence together.

## Command timing

`deno run -A bench/run.ts command NAME COMMAND [ARGS...]` measures a whole
command through exit and child reaping. Timing is report-only: the command's
exit code remains authoritative. The result keeps wall seconds, CPU seconds,
timestamp and exit code, while the baseline judges CPU seconds. No control
worker or wall/control ratio participates.

A suite named `NAME` writes `bench/suite-<URL-encoded-name>.results.json` and
checks `bench/suite-<URL-encoded-name>.baseline.json` when present. Long names
use a shortened filename with a digest; the JSON keeps the complete name. The
committed baseline supplies its tolerance. `SUITE_ACCEPT=1` banks a measurement
with a 25% tolerance; failed commands cannot be accepted. A command without a
baseline records without comparing. `command --ci` takes its suite name from
`SUITE_STEP`, prefixed with `ci/`, and appends its report to the GitHub job
summary when available.

## Per-test budget

The test runner records both wall milliseconds (`ms`) and CPU milliseconds
(`cpu`). Its per-test performance budget uses CPU time from the same shared
clock, including asynchronous work and cleanup. Timer and I/O waits add no CPU
usage; the runner's hang timeout is separate from this budget.

Existing exceptions in `bench/test-budget.json` carry
`records: 'legacy-wall-ceilings'`: they remain upper bounds rather than claims
that old wall measurements were CPU measurements. `deno task test --write`
lowers those records with CPU samples under the budget's existing ratchet. See
[test runner reports](../packages/testing/README.md#running) for the report
format.

## Relay admission boundary

`relay/store/entities-*` measures one value from WebSocket submission through
admission and staging on a warmed Store. Its controlled clock stays fixed
through that work. The fixture flushes fanout and verifies delivery after the
timed interval. A skipped or refused value fails instead of becoming a cheap
sample. SQL counts cover the same interval. Both throughput and
`relay-admission` use this boundary; see
[relay admission](README.md#relay-admission).
