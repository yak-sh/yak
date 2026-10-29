# @yaks/benchmark

Named workloads, raw samples, JSON runs and explicit baseline ratchets, with
process-configured reporters.

A **bench** is a named workload with a unit, such as `apply` in `ns/op`. A
**sample** is one measured value, with optional counts and provenance. A
**round** collects samples from every bench. A **suite** names a set of benches,
its aggregation metric and its workload version. A **run** keeps the samples,
round medians, median of round medians, commit, runtime, CPU, load average and
how busy the box was. A **baseline** is a committed JSON file for one suite,
with a tolerance: `0.2` allows a 20% deterioration. A **reporter** receives a
completed run after its JSON has been written.

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
process to measure several benches. Missing, extra and duplicate names fail. A
suite can supply `close()` to dispose persistent collectors; the runner calls it
after measurement, including on failure.

`@yaks/benchmark/deno` imports reports from a CPU-aware Deno workload collector.
Each result supplies its wall average (`avg`) and CPU average (`cpu`), both in
ns/op:

```ts
import { extract } from '@yaks/benchmark/deno'
import { equal } from '@yaks/testing'

let imported = extract({
  version: 1,
  runtime: 'test-runtime',
  cpu: 'test-cpu',
  benches: [{ name: 'read', results: [{ ok: { avg: 42, cpu: 30, n: 100 } }] }],
}, ['read'])
equal(imported.read.value, 42)
equal(imported.read.cpu, 30)
equal(imported.read.source, 'deno-cpu-average')
equal(imported.read.details, { avg: 42, cpu: 30, n: 100 })
```

The collector supplies batch averages and statistics, not individual invocation
timings. These samples retain that provenance and their statistics; they cannot
reconstruct the distribution of operation times. Native timed benches keep every
invocation sample. All samples must be finite and nonnegative; imported wall
averages must be positive and imported CPU averages are required. Native
`deno bench --json` output lacks the CPU average and cannot be imported.

## CPU time

`cpu` is the CPU time a step took, in the bench's unit: this process and its
finished children, every thread, user and system (`cputime()`, getrusage(2) on
Linux and macOS). `bench()` records it automatically; external collectors spread
a `stopwatch()` reading into each sample. `run(suite, { figure: 'cpu', ... })`
requires CPU in every sample and judges its median. Raw `value` retains wall
time for diagnostics; the result's metric gains a `/cpu` suffix so it cannot
compare against a baseline of wall values. Missing CPU never falls back to wall
time. CPU accounting requires getrusage(2) on Linux or macOS; other platforms,
including Windows, fail explicitly. CPU runs record load averages without
waiting to sample host pressure.

```ts
import { type Sample, stopwatch } from '@yaks/benchmark'
import { ok } from '@yaks/testing'

let took = stopwatch()
let x = 0
for (let i = 0; i < 1e4; i++) x += i
let sample: Sample = { ...took(), source: 'end-to-end' }
ok(x > 0 && sample.value >= 0 && (sample.cpu ?? 0) >= 0)
```

A child counts once it has exited and been waited for. A long-lived server
reports its own CPU at the measured boundaries. `stopwatch(...sources)` adds
synchronous CPU counters for other processes or cgroups to the caller's CPU;
`processCpu(pid)` reads a Linux process tree, including every live thread and
reaped children. Keep the observed process alive across both readings. Pure
waiting remains diagnostic rather than a CPU benchmark.

## Runner and ratchet

`run()` writes a result in all three modes. `check` reads the committed baseline
and throws `Regressed` after writing and reporting a failed run. `accept` writes
a baseline only when explicitly requested, with an explicit tolerance. Commit
and review that file. A missing or malformed baseline fails a check before any
work runs. A check never changes the baseline or overrides its tolerance.

A figure counts only where it clears the noise. A bench's **spread** is how far
apart its round medians fell, across every run of the measurement, as a fraction
of the best (`spread()`). With `runs: n`, a run measures the suite n times over
and keeps each bench's `best()` median and the spread of all its rounds.
Acceptance banks each bench with a **slack** of its own: `NOISE` (2) times its
spread, never under the explicit tolerance and never over `CAP` (0.95). A count
that never varies banks no slack, so any change to it counts. A check holds each
bench to its banked slack, or to `NOISE` times the spread the check itself
measured where that is wider, so a regression is a figure past the noise of both
measurements; each regression carries the `limit()` it passed.

A baseline moves only toward better, and only past the noise: `accept` banks a
bench's new median where the banked one would have regressed against it, and
otherwise keeps the banked median with the wider of the two slacks.
`slower: true` banks the measurement as it is, which is a decision about the
product, not a measurement; `slower: ['close']` makes that decision for the
named benches only, and every other bench stays as banked. A baseline banked on
another runtime, CPU or workload version is no reference, and an exact
acceptance banks the suite as measured.

Each baseline bench can retain a `reference` commit for its median. Acceptance
stamps a changed median with the measured run's commit and preserves the
reference of every retained median, including benches outside a scoped
acceptance. A baseline with one shared reference also keeps it at the top level;
that field remains the fallback for older baselines without bench references.

When judging `value`, a run is **loaded** when other work used more than `BUSY`
(a quarter) of the box's CPUs (`loaded()`). Before each round of a check or an
acceptance, inside the lock, the runner samples a second of the box while the
bench rests (`busy()`, from the cgroup's CPU use, a container's own) and keeps
the most as the run's `busy`, so the bench's own work, and what it asks of a
server, never counts against it; where the box does not say, it is null and
nothing is loaded. It is use, not CPU pressure: a busy hyperthread slows the
work on its sibling without making anything wait for a CPU. A loaded run banks
nothing, and a loaded check past its limit is `loaded`, not `regressed`: it can
tell nothing either way. A box's load average says less: a container's often
reads its host's.

CPU runs skip that host-pressure sampling and use CPU measurements directly.
`waited()` exposes the calling thread's Linux scheduling delay as a separate
diagnostic; it does not measure CPU usage.

```ts
import { type Files, type Host, Regressed, run } from '@yaks/benchmark'
import { equal, ok, throws } from '@yaks/testing'

let cost = 100
let suite = {
  name: 'cost',
  metric: 'median-of-round-medians',
  workload: 1,
  benches: [{ name: 'write', unit: 'ms', sample: () => cost }],
}
let saved = new Map<string, string>()
let files: Files = {
  read: async (path) => {
    if (!saved.has(path)) throw new Deno.errors.NotFound(path)
    return saved.get(path)!
  },
  write: async (path, value) => void saved.set(path, JSON.stringify(value)),
}
let read = (path: string) => JSON.parse(saved.get(path)!)
let options = {
  output: 'cost.results.json',
  baseline: 'cost.baseline.json',
  files,
  rounds: 1,
  // An idle box, so the example never depends on what else this one runs.
  host: (): Host => ({
    config: {},
    configURL: null,
    commit: null,
    runtime: 'example',
    cpu: 'example',
    load: [0, 0, 0],
  }),
}
await run(suite, { ...options, mode: 'accept', tolerance: 0.2 })
equal((await run(suite, { ...options, mode: 'check' })).verdict, 'passed')
cost = 130
let error = await throws(() => run(suite, { ...options, mode: 'check' }))
ok(error instanceof Regressed)
equal(read(options.output).verdict, 'regressed')
equal(read(options.baseline).benches[0].median, 100)
```

A scoped run measures part of a suite, and a resolution rounds the limit:

```ts
import { type Files, run } from '@yaks/benchmark'
import { equal } from '@yaks/testing'

let saved = new Map<string, string>()
let files: Files = {
  read: async (path) => {
    if (!saved.has(path)) throw new Deno.errors.NotFound(path)
    return saved.get(path)!
  },
  write: async (path, value) => void saved.set(path, JSON.stringify(value)),
}
let suite = (name: string, sample: () => number, resolution?: number) => ({
  name: 'cost',
  metric: 'median-of-round-medians',
  workload: 1,
  benches: [{ name, unit: 'ms', resolution, sample }],
})
let options = (baseline: string) => ({
  output: 'cost.results.json',
  baseline,
  files,
  rounds: 1,
  host: () => ({
    config: {},
    configURL: null,
    commit: null,
    runtime: 'example',
    cpu: 'example',
    load: [0, 0, 0],
  }),
})
let base = options('cost.baseline.json')
await run(suite('write', () => 100), { ...base, mode: 'accept', tolerance: .2 })
let subset = { ...base, coverage: 'subset' as const }
let scoped = suite('read', () => 50)
equal((await run(scoped, { ...subset, mode: 'check' })).verdict, 'measured')
await run(scoped, { ...subset, mode: 'accept', tolerance: 0.2 })
equal(
  JSON.parse(saved.get(base.baseline)!).benches.map((b: { name: string }) =>
    b.name
  ),
  ['write', 'read'],
)
let duration = 2106
let rounded = suite('deploy', () => duration, 1)
let precise = options('rounded.baseline.json')
await run(rounded, { ...precise, mode: 'accept', tolerance: 0.25 })
duration = 2633
equal((await run(rounded, { ...precise, mode: 'check' })).verdict, 'passed')
```

Compatibility includes suite, metric, workload version, runtime, CPU, bench
names, units, directions and resolution. Equality at the tolerance boundary
passes. Change the workload version when the corpus or timed boundary changes.
`baseline()`, `best()`, `compare()`, `limit()`, `loaded()` and `spread()` expose
the same ratchet as pure functions.

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
compatible with shell `flock`. Never unlink it. Each round holds the lock
through its fixture cleanup, then releases it so a queued suite can measure.
Publishing results and banking a baseline also take the lock and reread the
latest baseline, so an acceptance cannot undo a faster one banked between
rounds. Measurements run sequentially; the lock cannot prevent contention from
programs that do not take it.

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
try {
  let suite = {
    name: 'delivery',
    metric: 'median-of-round-medians',
    workload: 1,
    benches: [{ name: 'read', unit: 'ms', sample: () => 1 }],
  }
  // Runs are kept nowhere: the example is about delivery, not files.
  let files = {
    read: () => Promise.reject(new Deno.errors.NotFound('delivery.json')),
    write: () => Promise.resolve(),
  }
  let options = { output: 'delivery.json', files, host: () => context }
  await run(suite, options)
  context.config.destination = 'second'
  await run(suite, options)
  equal(delivered, ['first', 'second'])
} finally {
  undo()
}
```

## Exports

| Subpath  | Exports                                                                                                                                                                                                                                         | Purpose                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `.`      | `bench`, `stopwatch`, `run`, `Regressed`                                                                                                                                                                                                        | Timed callbacks and JSON runner.                   |
| `.`      | `median`, `baseline`, `best`, `compare`, `limit`, `loaded`, `spread`, `Coverage`                                                                                                                                                                | Pure aggregation and ratchet.                      |
| `.`      | `busy`, `cputime`, `processCpu`, `waited`, `configure`, `host`                                                                                                                                                                                  | Process reporter factory and current host context. |
| `.`      | `Bench`, `TimedBench`, `Iteration`, `TimeUnit`, `Suite`, `CollectedSuite`, `Workload`, `Direction`, `Sample`, `Samples`, `Round`, `Result`, `Run`, `Baseline`, `Regression`, `Host`, `Reporter`, `ReportedRun`, `Reporters`, `Options`, `Files` | Authoring, result, host and effect-boundary types. |
| `./deno` | `extract`, `DenoReport`                                                                                                                                                                                                                         | Deno JSON import with provenance.                  |

The package provides no tracker transport, timing buckets, retention or views.
Those consume the completed run through a reporter. Writing JSON needs Deno
filesystem permission; host metadata needs environment, read and Git execution
permission. The root export targets Deno; the pure modules themselves have no
machine effects.
