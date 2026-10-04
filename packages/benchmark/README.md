# @yaks/benchmark

Named workloads, raw samples, JSON runs and explicit baseline ratchets, with
process-configured reporters.

A **bench** is a named workload with a unit, such as `apply` in `ns/op`. A
**sample** is one measured value, with optional counts and provenance. A
**round** collects samples from every bench. A **suite** names a set of benches,
its aggregation metric and its workload version. A **run** keeps the samples,
round medians, median of round medians, commit, runtime, CPU and load average. A
**baseline** is a committed JSON file for one suite, with a tolerance: `0.2`
allows a 20% deterioration. A **reporter** receives a completed run after its
JSON has been written.

## Writing a bench

`bench()` times sync or async callbacks. `iterations` keeps separate invocation
samples; `operations` divides each invocation's time by its operation count.
Setup and teardown run outside the timed interval for every invocation. A unit
with a denominator, such as `ns/op`, `ns/bundle` or `us/value`, permits
operation normalization.

```ts
import { bench, run } from '@yaks/benchmark'
import { equal, ok } from '@yaks/testing'

let calls = 0
let suite = {
  name: 'arithmetic',
  metric: 'median-of-round-medians',
  workload: 1,
  benches: [bench({
    name: 'increment',
    unit: 'ns/op',
    iterations: 4,
    operations: 10,
    run: () => {
      for (let i = 0; i < 10; i++) calls++
    },
  })],
}
let directory = await Deno.makeTempDir()
try {
  let result = await run(suite, {
    rounds: 3,
    output: directory + '/arithmetic.results.json',
  })
  equal(calls, 120)
  equal(result.benches[0].samples.length, 12)
  equal(result.benches[0].rounds.length, 3)
  ok(result.benches[0].median >= 0)
  equal(
    JSON.parse(await Deno.readTextFile(directory + '/arithmetic.results.json'))
      .suite,
    'arithmetic',
  )
} finally {
  await Deno.remove(directory, { recursive: true })
}
```

Run bench files separately with `deno run -A path/to/bench.ts`; importing a
definition registers no test and executes no workload. Bench measurements belong
outside the test suite. An invocation's return value is ignored; a returned
Promise is awaited. A bench that times a batch uses `operations` for the number
of operations in that batch.

## Externally measured samples

For a script that already measures a phase, batch, ratio or cost, write a
`Bench` with `sample(round)` instead of a timed callback. It returns a number, a
sample or an array of samples. Units are arbitrary strings; `better` is `lower`
by default and can be `higher` for throughput.

```ts
import type { Bench } from '@yaks/benchmark'
import { equal } from '@yaks/testing'

let relay: Bench = {
  name: 'relay/10-entities',
  unit: 'us/value',
  sample: (round) => ({
    value: [12, 10, 11][round],
    counts: { values: 2000, statements: 4000 },
    source: 'batch',
  }),
}
equal(await relay.sample(1), {
  value: 10,
  counts: { values: 2000, statements: 4000 },
  source: 'batch',
})
```

A `CollectedSuite` supplies `collect(round)` and workload names and units. Its
collector returns a map of samples for exactly those names, allowing one child
process to measure several benches. Missing, extra and duplicate names fail.

`@yaks/benchmark/deno` imports `deno bench --json` reports:

```ts
import { extract } from '@yaks/benchmark/deno'
import { equal } from '@yaks/testing'

let imported = extract({
  version: 1,
  runtime: 'test-runtime',
  cpu: 'test-cpu',
  benches: [{ name: 'read', results: [{ ok: { avg: 42, min: 20, n: 100 } }] }],
}, ['read'])
equal(imported.read.value, 42)
equal(imported.read.source, 'deno-average')
equal(imported.read.details, { avg: 42, min: 20, n: 100 })
```

Deno supplies averages and statistics, not individual invocation timings. These
samples retain that provenance and their statistics; they cannot reconstruct the
distribution of operation times. Native timed benches keep every invocation
sample. All samples must be finite and nonnegative; Deno averages must be
positive.

## Runner and ratchet

`run()` writes a result in all three modes. `check` reads the committed baseline
and throws `Regressed` after writing and reporting a failed run. `accept` writes
a baseline only when explicitly requested, with an explicit tolerance. Commit
and review that file. A missing or malformed baseline fails a check before any
work runs. A check never changes the baseline or overrides its tolerance.

```ts
import { Regressed, run } from '@yaks/benchmark'
import { equal, ok, throws } from '@yaks/testing'

let cost = 100
let suite = {
  name: 'cost',
  metric: 'median-of-round-medians',
  workload: 1,
  benches: [{ name: 'write', unit: 'ms', sample: () => cost }],
}
let directory = await Deno.makeTempDir()
let options = {
  output: directory + '/cost.results.json',
  baseline: directory + '/cost.baseline.json',
}
try {
  await run(suite, { ...options, mode: 'accept', tolerance: 0.2 })
  equal((await run(suite, { ...options, mode: 'check' })).verdict, 'passed')
  cost = 130
  let error = await throws(() => run(suite, { ...options, mode: 'check' }))
  ok(error instanceof Regressed)
  equal(
    JSON.parse(await Deno.readTextFile(options.output)).verdict,
    'regressed',
  )
  equal(
    JSON.parse(await Deno.readTextFile(options.baseline)).benches[0].median,
    100,
  )
  let scoped = {
    ...suite,
    benches: [{ name: 'read', unit: 'ms', sample: () => 50 }],
  }
  let subset = { ...options, coverage: 'subset' as const }
  equal((await run(scoped, { ...subset, mode: 'check' })).verdict, 'measured')
  await run(scoped, { ...subset, mode: 'accept', tolerance: 0.2 })
  equal(
    JSON.parse(await Deno.readTextFile(options.baseline)).benches.map((b: {
      name: string
    }) => b.name),
    ['write', 'read'],
  )
  let duration = 2106
  let rounded = {
    ...suite,
    benches: [{
      name: 'deploy',
      unit: 'ms',
      resolution: 1,
      sample: () => duration,
    }],
  }
  let precise = { ...options, baseline: directory + '/rounded.baseline.json' }
  await run(rounded, { ...precise, mode: 'accept', tolerance: 0.25 })
  duration = 2633
  equal((await run(rounded, { ...precise, mode: 'check' })).verdict, 'passed')
} finally {
  await Deno.remove(directory, { recursive: true })
}
```

Compatibility includes suite, metric, workload version, runtime, CPU, bench
names, units, directions and resolution. Equality at the tolerance boundary
passes. Change the workload version when the corpus or timed boundary changes.
`baseline()` and `compare()` expose the same ratchet as pure functions.

A bench's optional **resolution** declares its sample precision in the bench's
unit. It must be finite and positive. The ratchet rounds the tolerance boundary
to the nearest multiple of that resolution, leaving samples and banked medians
unchanged. For example, `resolution: 1` with `unit: 'ms'` rounds a 2632.5 ms
limit to 2633 ms. Without a resolution the boundary is unrounded. Baseline and
current bench resolutions must match.

`coverage: 'subset'` permits a run to observe only part of a suite, such as one
host's deployment measurements. It compares the measured benches that have a
baseline; if any measured bench is unbanked, a run without regressions is
`measured` rather than `passed`. Acceptance retains baseline benches outside the
observation, with matching suite, metric, workload, runtime and CPU. Exact
coverage is the default and rejects any changed bench set. `baseline()` accepts
an optional previous baseline to retain unmeasured benches; `compare()` accepts
the coverage as its third argument.

`lock` optionally names a box-wide flock file, shared across worktrees and
compatible with shell `flock`. Never unlink it. Measurements run sequentially;
the lock cannot prevent contention from programs that do not take it.

## Recorded spans

Timed benches use [record()](../trace/README.md) for each invocation. Set
`target` to the observed object, such as a graph, to record its operation's
tree. The operation's root must begin synchronously, as `record()` requires.
Only that root and its descendants are captured: a callback making several
independent graph calls records the first call's tree. Without a target, the
tree contains a `bench` span for the invocation. Setup and teardown are outside
the recording as well as outside timing.

```ts
import { bench } from '@yaks/benchmark'
import { during, peek } from '@yaks/trace'
import { equal } from '@yaks/testing'

let target = {}
let work = bench({
  name: 'apply',
  unit: 'ms',
  target,
  run: () =>
    during(peek(target)?.begin({ kind: 'apply', name: 'apply' }), () => 1),
})
let samples = await work.sample(0)
equal(Array.isArray(samples) && samples[0].spans?.[0].name, 'apply')
```

Each round keeps the middle sample's tree; each bench result keeps the middle
round's tree. For an even count the numeric median averages the two middle
values, and the tree belongs to the upper middle value. Samples without a
recording have a `null` tree in the run. Recording enables subscribed trace
instrumentation on the target, so its cost is included in the workload timing.

## Process reporters

The runtime boundary reads `$YAK_CONFIG`, else `~/.yak/yak.json`, on each run.
With no host config it uses an empty config. An explicitly named missing config
fails. The default reporter factory returns no reporters, so runs write JSON
only. Provider integration belongs at this boundary, never in bench modules.

`configure(factory)` installs a factory for the process. It receives the current
host config, config URL, commit and machine metadata. Relative provider paths
can be resolved against `host.configURL`. It returns an undo function for
temporary installations. `run({…}, {reporters: factory})` overrides the factory
for an embedding host. The run's JSON is written before every reporter receives
it, including a regression. Reporters receive an immutable snapshot of the saved
JSON. A failed factory or reporter is logged and does not prevent other
reporters from receiving the run or change the ratchet verdict.

```ts
import { configure, type Host, run } from '@yaks/benchmark'
import { equal } from '@yaks/testing'

let delivered: string[] = []
let context: Host = {
  config: { destination: 'first' },
  configURL: null,
  commit: 'abc',
  runtime: 'test',
  cpu: 'test',
  load: [0, 0, 0],
}
let undo = configure((host) => [() => {
  delivered.push(String(host.config.destination))
}])
let directory = await Deno.makeTempDir()
try {
  let suite = {
    name: 'delivery',
    metric: 'median-of-round-medians',
    workload: 1,
    benches: [{ name: 'read', unit: 'ms', sample: () => 1 }],
  }
  let options = { output: directory + '/delivery.json', host: () => context }
  await run(suite, options)
  context.config.destination = 'second'
  await run(suite, options)
  equal(delivered, ['first', 'second'])
} finally {
  undo()
  await Deno.remove(directory, { recursive: true })
}
```

## Exports

| Subpath  | Exports                                                                                                                                                                                                                                         | Purpose                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `.`      | `bench`, `run`, `Regressed`                                                                                                                                                                                                                     | Timed callbacks and JSON runner.                   |
| `.`      | `median`, `baseline`, `compare`, `Coverage`                                                                                                                                                                                                     | Pure aggregation and ratchet.                      |
| `.`      | `configure`, `host`                                                                                                                                                                                                                             | Process reporter factory and current host context. |
| `.`      | `Bench`, `TimedBench`, `Iteration`, `TimeUnit`, `Suite`, `CollectedSuite`, `Workload`, `Direction`, `Sample`, `Samples`, `Round`, `Result`, `Run`, `Baseline`, `Regression`, `Host`, `Reporter`, `ReportedRun`, `Reporters`, `Options`, `Files` | Authoring, result, host and effect-boundary types. |
| `./deno` | `extract`, `DenoReport`                                                                                                                                                                                                                         | Deno JSON import with provenance.                  |

The package provides no tracker transport, timing buckets, retention or views.
Those consume the completed run through a reporter. Writing JSON needs Deno
filesystem permission; host metadata needs environment, read and Git execution
permission. The root export targets Deno; the pure modules themselves have no
machine effects.
