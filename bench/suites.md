# Suite and CI wall clocks

`deno task check`, `test`, and `test:workerd` time the complete command
(including Deno startup and discovery). Their original commands live under
`:run`; use those only when intentionally bypassing timing. Arguments and exit
statuses pass through. Timing is **report-only**, matching the performance steps
in CI: a regression is printed as `REGRESSION`, not turned into a failing test
or a deployment veto.

`bench/results.json` now has a `suiteTimings` namespace beside the throughput
bench's existing fields. Each row records seconds, mean control seconds, sample
count, timestamp, command exit code, ratio, baseline, and verdict. The default
relative threshold is 25% (`SUITE_TOL`). `bench/suite.baseline.json` retains the
floors across clean checkouts; review and commit its ratchet changes. The
ignored results file is an observation artifact, not a source file. Both
producers preserve the other's namespace. Independent simultaneous invocations
must use separate `SUITE_RESULTS` paths (and directories); the normal suite and
CI flow is sequential.

## Load compensation

A separate worker warms a fixed 8-million-step dependent LCG, then samples it
once per second throughout the command. The ratio is wall seconds divided by
mean control seconds. Thus a suite and control both taking twice as long have
the same ratio. The worker consumes roughly 40 ms of one CPU per second at idle;
this is part of the measurement protocol, not a benchmark of the application. No
control sample is taken from application code. Short commands use at least one
sample.

Quiet improvements ratchet down. A control above 1.5x its stored floor marks a
loaded run: regressions still report, but improvements are not banked. Failed
commands are recorded but never establish or change a floor. A new row or metric
version starts a fresh baseline. Changing the control or sampling protocol MUST
bump `VERSION` in `bin/suite-time.ts`. To intentionally accept a changed
workload or a correctness tradeoff, run `SUITE_ACCEPT=1 deno task <suite>`; the
log says `ACCEPTED` and shows the delta, including regressions. Do not accept a
failed command.

This cancels approximately uniform CPU contention, not network delays, cold
caches, I/O contention, or changes in a parallel suite's CPU saturation. The 25%
band is a starting noise allowance, not a claim that a CPU reference perfectly
models every suite. Investigate repeated regressions before accepting them. Keep
cold CI rows separate from local suite rows; do not compare seconds across the
two environments.

For a per-step investigation and a repeated-body write regression fixed without
changing the timing threshold, see [check regression T-37417](check-37417.md).
For the fleet suite’s per-file profile, fixture fixes and independent-process
runner, see [fleet suite T-37421](test-37421.md).

## CI

The gate's custom shell times every executed **run step**, including path
detection, deploy recording, tests, and performance reports. Each has a stable
`ci/<step name>` row. Skipped steps produce no new measurement. The checkout and
artifact-upload Actions are not shell commands and are not timed by this
wrapper; their wall clocks remain in GitHub's job timeline. The job summary
receives each timing report, and an `always()` artifact step retains results
even after a failure. The CI wrapper also measures suite wrapper overhead; local
suite and CI-step rows are intentionally separate. No extra paid runner, API
credential, or deployment dependency is added.

CI also prefixes its nested suite rows with `ci/suite/`, so a cold checkout does
not ratchet a local warm-cache baseline. The artifact includes the updated
baseline file; commit reviewed CI floors with the next change, just like the
bench ratchet. Until a CI row has a committed floor, it reports `NEW`, not a
regression.
