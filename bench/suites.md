# Suite CPU timing

Repository benchmark suites judge CPU time through
[@yaks/benchmark](../packages/benchmark/README.md#cpu-time). Every timed sample
keeps CPU usage alongside its wall duration. The runner selects `figure: 'cpu'`
and the monitor's paired comparison requires CPU in every round; neither falls
back to wall time. SQL statement and row counts remain separate measurements.

`bench/deno-worker.ts` collects existing `Deno.bench` declarations with the
shared CPU clock. An authored `n` and `warmup` set the measured and discarded
invocation counts exactly. Without `n`, adaptive calibration is bounded by CPU
usage of the whole invocation, including fixture creation and teardown, so a
tiny timed act cannot multiply costly setup indefinitely. Automatic sampling
targets 200 ms of measured CPU and budgets one second of whole-invocation CPU
for calibration growth. The retained batch must itself meet the measured
minimum. Otherwise its typed `sampling.status: 'insufficient'` makes the run and
paired comparison `inconclusive`; the monitor files no regression or failure for
that observation, and no baseline is banked. Authored `n` and `warmup` stay
exact. Each collection then reports one measured batch's CPU and wall averages
in ns/op, retaining the CPU average in `details.cpuSamples`. Paired rounds
provide repeated observations. Explicit `start()` and `end()` boundaries exclude
fixture setup and teardown from measured work. Workload files need no separate
CPU instrumentation.

Each paired collector uses the shared apply declaration: one warmup and one
measured invocation per case. Each callback retains its full 200 or 1,000
writes, private corpus, and 20 fixture warm writes. Paired rounds repeat the
measured CPU observations. The retained apply cases are
`apply/file/edit-alone-1000`, `apply/file/create-alone-200` and
`apply/file/create-alone-1000`. Recording keeps the same cases and their
`/subscribed` variants, grouping five complete fixture workloads per callback.
Throughput contains only those three file cases. The 40 automatic
storage/query/archetype timings and 13 other apply timings are retired; all 56
original CPU comparisons, wall medians and source identities are retained in
[baseline provenance](baseline-references.json). Its three earlier Store relay
retirements are recorded separately from those 53 short timings.

Collectors retain their process and product imports across rounds. Deno workload
modules load afresh for each collection, with fixture disposal awaited before
the result returns. Standalone collectors call the module's `measure()` to
create and dispose each fixture. The suite's `close()` releases its collectors
after measurement, including on failure.

## Process accounting

The shared `stopwatch()` reads `cputime()`: getrusage(2) user and system time on
Linux and macOS for every thread in the process, plus children that have exited
and been waited for. Unsupported platforms fail explicitly. Waiting for a timer,
I/O or a CPU adds no CPU time. A subprocess that exits inside the measured
interval contributes its work through its parent's child usage.

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

A CPU baseline measures each benchmark at its own reference product revision,
using the current driver. A partial acceptance can leave a suite with medians
banked at different revisions. The paired collector groups benchmarks by their
`benches[].reference`, measuring only each group against its reference; a
top-level `reference` remains the fallback for homogeneous or older baselines.
Run the conversion for selected registered suites:

```sh
deno run -A bench/rebank.ts throughput relay-admission
```

The conversion holds `/tmp/yaks-throughput-bench.lock` and uses the same paired
collector as the monitor: warm both revisions, then alternate reference,
current, reference measurements. Both revisions use identical benchmark files
and the shared CPU clock over their own product code. Each probe owns its
fixture; no live graph is copied.

Only the reference readings are banked. Their spread supplies the baseline's
slack, and each bench's `reference` retains its measured product commit. A
slower current reading stays visible in the comparison rather than becoming the
CPU baseline. An inconclusive comparison or failed workload banks nothing.
`bench/<suite>.rebank.results.json` retains the evidence and
`bench/cpu-baselines.json` records each suite's reference, current revision,
verdict and figures.

`bench/baseline-references.json` records the reference selection for each
benchmark group and its source. `kind: "recorded"` identifies an explicitly
recorded measurement revision; `kind: "derived"` identifies the Git revision
that introduced the unchanged median when no measured revision was recorded. A
derived origin is a reconstruction, not proof of which checkout produced the old
measurement. The conversion retains this provenance beside its CPU results.
Commit the baseline changes and retained evidence together.

`relay-admission` retains the three `graph-full-check/{1,10,100}-entities` CPU
workloads. Store admission timings `relay/store/entities-{1,10,100}` and
`store-relay/{1,10,100}-entities` are retired because their historical Store
cannot run the fixture with its own clock without shared runtime clock changes.
The five relay behavior tests remain. Retired timing medians, references and
reasons are retained in [baseline provenance](baseline-references.json).

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
