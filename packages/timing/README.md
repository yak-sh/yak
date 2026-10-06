# @yaks/timing

Pure closed-minute timing summaries and slow or representative span-tree
selection for tracker stores. It consumes
[@yaks/trace events and span trees](../trace/README.md), and declares the
`timing`, `trace`, `span` and metric components.

A **minute row** is a [bundle](../graph/README.md#data-model) containing
`timing{op, name, plugin, at, n, total, max, buckets, counts, commit}` beside
the tracker's [`during{process}`](../tracker/README.md). It summarizes completed
spans and instants for one process, op, name, plugin and UTC minute. A **stored
trace** is `trace{op, name, at}` beside tracker `during` context. A **stored
span** is a separate entity with
`span{trace, parent, op, name, plugin, package,
outcome}` referring to its trace
and containing span. Each measurement has its own component:
`elapsed{start, ms}`, `rows_read{n}`, `rows_written{n}` and `statements{n}`.
`elapsed.start` is relative to the trace root; unfinished spans omit
`elapsed.ms`. The components can be removed independently.

```ts
import { sample, summarize } from '@yaks/timing'
import type { Event } from '@yaks/trace'
import { equal, ok } from '@yaks/testing'

let origin = Date.parse('2026-01-01T00:00:00Z')
let spans: Event[] = [{
  id: '1.1',
  kind: 'apply',
  name: 'apply',
  stage: 'end',
  start: 100,
  time: 120,
  duration: 20,
  outcome: 'ok',
  counts: { bundles: 3 },
}]
let rows = summarize(spans, {
  process: 'a3f19c02-4b00-4000-8000-000000000001',
  origin,
  before: origin + 60_000,
})
equal(rows[0].timing.n, 1)
equal(rows[0].timing.total, 20)
equal(rows[0].timing.counts, { bundles: 3 })
equal(rows[0].timing.buckets.reduce((a, b) => a + b), 1)
let selected = ok(
  sample(spans, { origin, eid: 'a3f19c02-4b00-4000-8000-000000000002' }).rows,
)
equal(selected[1].elapsed, { start: 0, ms: 20 })
```

## Exports

| Export               | Provides                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/timing`       | `summarize`, `bounds`, `sample`, `project`, `selectedRequest`, `sampleRequest`, `thresholds`, `timingDoc`; summary, trace and sampling types |
| `@yaks/timing/vocab` | `timingDoc`, `docs`, `description`                                                                                                           |

## Closed-minute summaries

`summarize(events, { process, origin, before, commit? }): TimingRow[]` is a pure
batch function. `origin` is epoch milliseconds at the channel's monotonic time
zero, normally `performance.timeOrigin`. `before` is supplied epoch
milliseconds. A span belongs to its completion minute, even if it started in an
earlier minute. Start events are ignored, end events with durations count once,
and instants count once with zero duration. Spans are inclusive: parent and
child durations are separate measurements, so their totals must not be added as
elapsed time.

Only minutes ending at or before `before` are returned. The host retains events
in open minutes, supplies every measurement once, and summarizes a minute only
after all its events have arrived. An empty minute produces no row. Repeating
the same input produces the same bundles without changing previous results.

The eid uses the graph's `derivedEid` on `timing|` followed by the JSON tuple
`[process, op, name, plugin, at]`. JSON distinguishes separators inside code
names. The process must have its own global eid for its lifetime. Missing plugin
attribution is the empty string. `commit`, when supplied, is the process's
commit sha. Closed rows are written once and remain immutable; resends have the
same eid. The identity crosses `during` and `timing`, so it is derived by the
reporter, rather than a vocabulary `identity` list, which names one component's
properties.

`buckets` contains 43 counts with fixed boundaries in milliseconds: bucket zero
is exact zero, the next 41 buckets have inclusive upper bounds
`2^-10, 2^-9,
..., 2^30`, and the last bucket is overflow. The first positive
bucket includes every duration above zero up to `2^-10`; each later positive
bucket excludes its previous upper bound. The exported `bounds` holds the 41
positive upper bounds.

Powers of two cover sub-microsecond work through multi-day operations with a
small fixed row. Exact zero has its own bucket because some runtimes' clocks
advance only during I/O. Overflow keeps arbitrarily long operations countable.
These boundaries never depend on a process, its samples or a bench run. Adding
corresponding bucket counts therefore gives exactly the histogram of the pooled
samples, while precomputed percentiles cannot be merged that way. Pool `n`,
`total` and metric `counts` by addition and `max` by maximum. `buckets` and
`counts` are JSON read whole.

## Tree selection

`sample(spans, { origin, eid, during?, thresholds? }, sampled?): Sample`
consumes one root-first span tree, as returned by `record()`. The result
contains an optional `rows` and `sampled`, a read-only set of ordinary op/minute
keys. Pass that set into the next call to preserve the quota, including across
channels in the same process.

Every completed root strictly past its op's threshold is kept. Slow roots never
consume the ordinary sample slot. Among the other roots, the first per op per
root-start minute is kept, irrespective of name or plugin. The defaults are
apply and tick 16 ms, request 500 ms, effect 1000 ms. Configuration overrides
individual ops; an op without a threshold still gets an ordinary sample.

```ts
import { sample } from '@yaks/timing'
import type { Event } from '@yaks/trace'
import { equal } from '@yaks/testing'

let origin = Date.parse('2026-01-01T00:00:00Z')
let sampled: ReadonlySet<string> = new Set()
let kept: number[] = []
for (let ms of [30, 8, 7, 40]) {
  let spans: Event[] = [{
    id: '1.1',
    kind: 'apply',
    name: 'apply',
    stage: 'end',
    start: 100,
    time: 100 + ms,
    duration: ms,
  }]
  let result = sample(spans, {
    origin,
    eid: 'a3f19c02-4b00-4000-8000-000000000002',
    thresholds: { apply: 20 },
  }, sampled)
  sampled = result.sampled
  if (result.rows) kept.push(result.rows[1].elapsed!.ms!)
}
equal(kept, [30, 8, 40])
equal(sampled.size, 1)
```

The caller can discard a minute's quota keys once no more trees starting in it
can finish. `sample` reads no clock and does not mutate the input tree or set.
It emits only code names, plugin attribution, outcomes and numeric metrics;
producers must follow [@yaks/trace's naming contract](../trace/README.md). Span
ids become globally derived entity ids, using the trace eid and the event id.
Parent ids refer to those span entities. `start` becomes milliseconds relative
to the root. Instants have `ms: 0`; unfinished descendants omit `ms`, and an
unfinished root is never selected. Events' additional fields are not copied.

## Request selection and projection

`selectedRequest({ rowsRead, rowsWritten, requested?, rate?, random? })` selects
requests strictly over 10,000 rows read or written, requested captures and
ordinary samples. `rate` defaults to zero; the host supplies a probability and
random draw. `sampleRequest(spans, options)` selects and projects a completed
request, returning no bundles when it is unselected.

```ts
import { sampleRequest, selectedRequest } from '@yaks/timing'
import { equal } from '@yaks/testing'

let counts = { rowsRead: 10_001, rowsWritten: 0 }
equal(selectedRequest(counts), true)
equal(
  selectedRequest({ rowsRead: 0, rowsWritten: 0, rate: 0.01, random: 0.5 }),
  false,
)
let rows = sampleRequest([{
  id: '1.1',
  kind: 'request',
  name: 'http',
  stage: 'end',
  start: 0,
  time: 0,
  duration: 0,
  counts: { ...counts, statements: 1 },
}], {
  ...counts,
  origin: 0,
  eid: 'a3f19c02-4b00-4000-8000-000000000002',
  during: { space: 'a3f19c02-4b00-4000-8000-000000000003' },
})!
equal(rows.length, 2)
equal(rows[1].rows_read, { n: 10_001 })
equal(rows[1].statements, { n: 1 })
equal(rows[1].during, rows[0].during)
```

`project(spans, { origin, eid, during? })` performs projection without
selection. It returns one trace bundle followed by one bundle per span, copying
tracker context onto every bundle so independently delivered chunks retain their
scope. Projection maps the numeric `rowsRead`, `rowsWritten` and `statements`
counts to separate components. Missing metrics stay absent; zero counts are
retained. Other runtime counts are not stored. Resends retain every entity id.
Neither projection nor selection reads a clock, draws randomness or mutates
inputs.

Hosts own subscriptions, tree assembly, clocks, trace eids, tracker context,
delivery, retention and pages. This package performs no I/O or graph writes.
