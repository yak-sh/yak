# Suite and CI wall clocks

`deno task check` and `deno task test` time the complete command (including Deno
startup and discovery). Their original commands live under `:run`; use those
only when intentionally bypassing timing. Arguments and exit statuses pass
through, and a run given arguments (`deno task test --tag=deno workers`) is a
suite of its own, named with them, so a narrowed run never becomes the whole
suite's floor. Timing is **report-only**, matching the performance steps in CI:
a regression is printed as `REGRESSION`, not turned into a failing test or a
deployment veto.

Each command is a suite in [@yaks/benchmark](../packages/benchmark/README.md).
`check` writes `bench/suite-check.results.json` and checks the committed
`bench/suite-check.baseline.json`; `test` has its own corresponding files. Other
names, including narrowed runs and CI steps, use
`bench/suite-<URL-encoded-name>.baseline.json` and `.results.json`. A result
keeps the raw wall seconds, mean control seconds, control sample count,
timestamp, command exit code and ratio alongside the runner's metadata. The
committed baseline supplies the 25% tolerance. Recording and checking never
change it.

Accept a reviewed measurement explicitly:

```sh
SUITE_ACCEPT=1 deno task check
SUITE_ACCEPT=1 deno task test
```

Review and commit each suite's baseline diff. Failed commands and loaded runs
cannot be accepted. A command without a baseline writes its measurement without
comparing it; explicit acceptance establishes the floor.

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
even after a failure. The CI wrapper also measures suite wrapper overhead; local
suites and CI steps are intentionally separate. No extra paid runner, API
credential, or deployment dependency is added.

CI also prefixes its nested suites with `ci/suite/`, so a cold checkout does not
ratchet a local warm-cache baseline. The artifact includes the per-suite result
files. Bank reviewed CI floors with `SUITE_ACCEPT=1`; until a CI step has a
committed baseline, it records without comparison.

Long command names use a shortened filename with a digest; the JSON keeps the
complete suite name, so distinct narrowed commands retain distinct results.
