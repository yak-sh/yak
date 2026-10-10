# @yaks/timing

Timing summaries, stored span-entity traces and trace views for insight into
request time and rows in tracker stores. It consumes
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
`elapsed{start, ms}`, `rows_read{n}`, `rows_written{n}`, `statements{n, ran}`
and `repeats{n}`. `repeats` is carried only by a root span and counts suppressed
automatic requests of the same operation and name. `elapsed.start` is relative
to the trace root; unfinished spans omit `elapsed.ms`. The components can be
removed independently.

`statements.ran` lists the SQL statements a span ran, read whole: each entry is
`{sql, n, rows_read, rows_written, ms}`, alike statements (the same text)
summed, those that read and wrote the most rows first. A `sql` span lists its
own statement; any other span lists those its `sql` spans ran, with those of any
span under it that the trace left out, so every statement whose producer gave
its text is listed on a stored span. The text is the producer's, every value in
it masked (@yaks/trace's `sql`). A list keeps twenty statements with their text;
one last entry without `sql` sums the rest.

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

| Export               | Provides                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/timing`       | `summarize`, `bounds`, `sample`, `project`, `selectedRequest`, `selectRequest`, `sampleRequest`, `TRACE_MAX_SPANS`, `thresholds`, `timingDoc`; summary, trace and sampling types |
| `@yaks/timing/views` | `views`, `inspectViews`: trace and span views, a trace's page and the trace list; `destinations`: the Traces page in a browsing app's sidebar                                    |
| `@yaks/timing/vocab` | `timingDoc`, `docs`, `description`                                                                                                                                               |

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

Store hosts use
`selectRequest({ op, name, now, rowsRead, rowsWritten,
requested?, rate?, random? }, state?)`
to bound automatic traces. Its result is `{ reason?, repeats, state }`: an
absent reason suppresses delivery, while `requested`, `sampled` or `automatic`
identifies an independent retention reason. Keep the returned state only in the
Store incarnation. Automatic traces are admitted once per operation and name per
rolling hour, measured from the last automatically admitted request. Repeated
over-the-line requests increase an in-memory count; the next admitted trace for
that code carries it. A requested capture or random sample bypasses the
automatic quota and carries pending repeats without resetting the automatic
hour. Sampling an over-the-line request therefore stays bounded by the sampling
rate, not by the automatic quota.

```ts
import { selectRequest } from '@yaks/timing'
import { equal } from '@yaks/testing'

let request = {
  op: 'request',
  name: 'http query',
  now: 1000,
  rowsRead: 20_000,
  rowsWritten: 0,
}
let first = selectRequest(request)
equal(first.reason, 'automatic')
let repeated = selectRequest({ ...request, now: 2000 }, first.state)
equal(repeated.reason, undefined)
let next = selectRequest({ ...request, now: 3_601_000 }, repeated.state)
equal(next.reason, 'automatic')
equal(next.repeats, 1)
```

`project(spans, { origin, eid, during?, repeats? })` performs projection without
selection. It returns one trace bundle followed by one bundle per span, copying
tracker context onto every bundle so independently delivered chunks retain their
scope. Projection maps the numeric `rowsRead`, `rowsWritten` and `statements`
counts to separate components, and lists each span's statements in
`statements.ran`. `project(spans, options, kept)` stores only the `kept` spans,
listing on them the statements of those left out, as `sampleRequest` does with
the spans its bound keeps. A supplied nonzero `repeats` count becomes
`repeats{n}` only on the root span. Missing metrics stay absent; zero counts are
retained. Other runtime counts are not stored. Resends retain every entity id.
Neither projection nor selection reads a clock, draws randomness or mutates
inputs.

Hosts own subscriptions, tree assembly, clocks, trace eids, tracker context,
delivery and retention. Views ask the host for stored entities; the pure timing
functions perform no I/O or graph writes.

## Trace views

`@yaks/timing/views` draws a stored trace and a stored span wherever an entity
is drawn by name: as a `Title`, a `Tile` or `List.Tile`, a `Card.Title` and an
`Inline` link, and a span on a page of its own (`Page` and `Full`): what it
measured, its trace, and the statements it ran, each with how many times it ran,
its rows and its time. These render through the host's hyperscript, so a
terminal lists the same rows a browser does. Configure `@yaks/timing` beside
`@yaks/tracker`, `@yaks/inspect` and a browser application; the inspector then
draws a trace's page and the trace list.

A **place** is the code a span ran: its `op`, `name` and `plugin`. Sibling spans
at one place read as one, their measurements summed, so a rule's two hundred
reads read as `query read ×200`. A **measure** is one of rows read, time, rows
written and statements; a page lays its traces out by one at a time, and keeps
the one chosen in the page's own graph.

A trace's page asks for its stored spans and shows where its work went on the
measure: a flamegraph draws each place as wide as the work done there and in
what it called, which hangs under it, and the places list beneath gives each
one's figure and share, leaving out the places that recorded none. A press on a
place opens it under its line: the statements its spans ran, alike ones summed,
and on the box its spans, each a link to its page. Beside it stands the newest
ordinary trace of the same request kind in the same store, among the latest 100
matching traces, drawn at its own scale, with the places whose own work differs
most between the two. An **ordinary trace** has recorded root rows read and
written at most 10,000, no error outcome or missing-parent fragment, and at most
500 ms if time is recorded. The recording reason is not stored; the page does
not claim this proves random sampling or request health. An absent ordinary
trace is stated, never substituted from another store or request kind.

Metrics are inclusive: parents contain their descendants. Root measurements
provide totals, including suppressed `repeats` when present; child metrics are
never added to their parents. A place's own work is its measurement less what it
called. Absent metrics are not zero. A Worker's clock stands still while it
computes, so a trace from one may record zero milliseconds; its page then says
so rather than drawing time. Missing parents and cycles remain visible as
fragments. Storage has no delivery-completion marker, so the page cannot
guarantee a trace arrived in full.

The trace list answers a query for traces, `/?q=.trace` or a narrower one such
as `.trace .trace.name="POST apply"`. It reads the latest 200 matching traces
and says so when more match. Traces of one request kind in one store stand
together, ordered by the measure, the kind with the most first; the five with
the most show, and the rest of a kind are a press away.

```ts
import { inspectViews } from '@yaks/timing/views'
import { equal, ok } from '@yaks/testing'

let page = ok(
  (await inspectViews()).find((v) => v.view === 'Full' && v.asks),
)
let trace = {
  entity: { eid: 'example-trace' },
  trace: { op: 'request', name: 'POST apply', at: '2026-01-01T00:00:00Z' },
}
equal(page.asks!(trace, {} as never, {}), {
  spans: '.span.trace=example-trace * .order=elapsed.start',
})
```

`sampleRequest` retains at most `TRACE_MAX_SPANS` (200) spans. It keeps the
request root, then ranks spans by rows read plus rows written, breaking ties by
elapsed time, and admits each span only together with its ancestors. Omitted
work stays in the nearest retained parent's inclusive metrics: do not add it
again. A parent's count minus its retained children's counts is its own plus
folded work. Summing those exclusive counts over the retained tree gives the
request total, including statements. Capture order, span identities and root
totals do not change; an ancestor path too large to fit is folded rather than
truncated.

```ts
import { sampleRequest, TRACE_MAX_SPANS } from '@yaks/timing'
import type { Event } from '@yaks/trace'
import { equal } from '@yaks/testing'

let spans: Event[] = [
  {
    id: 'root',
    kind: 'request',
    name: 'query',
    stage: 'end',
    time: 0,
    duration: 0,
    counts: { rowsRead: 5000, statements: 5000 },
  },
  ...Array.from({ length: 5000 }, (_, i): Event => ({
    id: String(i),
    parent: 'root',
    kind: 'sql',
    name: 'select',
    stage: 'end',
    time: 0,
    duration: 0,
    counts: { rowsRead: 1, statements: 1 },
  })),
]
let rows = sampleRequest(spans, {
  requested: true,
  rowsRead: 5000,
  rowsWritten: 0,
  origin: 0,
  eid: 'a3f19c02-4b00-4000-8000-000000000001',
})!
equal(rows.length, TRACE_MAX_SPANS + 1)
equal(rows[1].rows_read, { n: 5000 })
equal(rows[1].statements, { n: 5000 })
```
