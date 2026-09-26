# @yaks/wake

`@yaks/wake` stores one-shot and recurring schedules in a graph, calculates
their next occurrence, and marks due schedules as fired. Application rules react
to the `fired` write and decide what work to perform.

A **host** is the process that opened the graph, such as a Deno server,
Cloudflare Worker, Durable Object, or browser tab. The host supplies the clock
and decides when to run the scheduler.

```sh
deno add jsr:@yaks/wake
```

Entry points:

- `@yaks/wake`: components, recurrence functions, due-wake queries, the graph
  plugin, and `tick`.
- `@yaks/wake/deno`: the long-running `loop` driver.
- `@yaks/wake/cloudflare`: Cron Trigger and Durable Object alarm helpers.
- `@yaks/wake/rules`: the `rules()` plugin list.
- `@yaks/wake/service`: a Deno background service wrapper.
- `@yaks/wake/vocab`: the vocabulary document without scheduler behavior.

## The rows

`wake{at, every, while, target, note}` stores the next ISO instant, optional
recurrence, the conditions it recurs under, related entity, and a reason.
`fired{at}` stores the most recent firing. A one-shot clears `wake.at` after
firing. A recurring wake advances `wake.at` to its next occurrence.

A **bundle** is one entity's components represented as a JSON object:

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { next, wakeDoc, wakes } from '@yaks/wake'

const vocab = loadVocab([wakeDoc, { $defs: { sweep: { component: true } } }])
const g = graph({ storage: ram(vocab), vocab, plugins: [wakes()] })

const every = '20 4 * * * America/Detroit'
await g.apply([{
  entity: { eid: 'cleanup' },
  wake: { every, at: next(every, Date.now()), note: 'collect expired trash' },
  sweep: {},
}])
```

`target` identifies what the wake concerns. The package stores no patch or
callback. Application rules match the components on the wake entity.

Use `wakes()` when constructing a graph. It loads `wakeDoc`, initializes a wake
that has `every` but no `at`, and refuses a `while` condition the graph cannot
read. An explicit `at: null` remains paused.

```ts ignore
import { wakes } from '@yaks/wake'

const g = graph({ storage, vocab, plugins: [wakes()] })
```

## Firing is a write

```ts ignore
import { tick } from '@yaks/wake'
import type { Rule } from '@yaks/graph'

const cleanup: Rule = {
  phase: 'effect',
  match: '.wake, *fired, .sweep, #Now',
  run: async ({ Now }) => await collectExpiredTrash(Now.at),
}

// Register cleanup in the application graph before ticking it.
const result = await tick(g, Date.now())
```

`tick(graph, now)` finds all due wakes. For each wake it submits one **batch**,
a list of changes applied in one transaction. The batch writes `fired{at}` and
updates or clears `wake.at`; `#Now` contains the same instant. A rule using
`*fired` runs only when that component was written in the current transaction.

Each wake has its own transaction. A precondition checks the `wake.at`,
`wake.every` and `wake.while` values read by the scheduler, preventing
concurrent drivers from consuming one occurrence twice or overwriting an edited
schedule. One rejected transaction does not stop other wakes. The result
contains `fired: Bundle[]` and `refused: { wake: Bundle; error: unknown }[]`.

Effect failures are reported after commit; they do not roll back the firing.
After downtime, an overdue recurring wake fires once and advances beyond `now`.
A process crash after commit can interrupt an effect; this package does not
durably retry effects.

## Recurrence

Durations preserve their cadence:

```text
30s   2m   90m   2h   1d   3d   1w
every 15 minutes     every 3 days
```

Cron expressions use minute, hour, day of month, month, and day of week. Fields
accept wildcards, ranges, steps, and lists. Sunday is `0` or `7`; if both day
fields are restricted, either may match. Named schedules are `@hourly`,
`@daily`, `@weekly`, and `@monthly`.

An optional trailing IANA time zone is stored in `every`:

```text
*/15 * * * *
5-50/15 9-17 * * 1-5
20 4 * * * America/Detroit
@daily Asia/Kathmandu
```

UTC is the default. `next(expr, from, tz?)` returns the next ISO instant
strictly after the epoch millisecond `from`, or `null`. The
`next(wake, now, { tz })` form keeps a duration anchored to the wake's current
`at` value.

[Croner](https://jsr.io/@hexagon/croner) evaluates calendars with `Intl`. A
missing spring time moves forward by the daylight-saving gap; a repeated fall
time fires at its first occurrence. An invalid expression or zone returns
`null`; a wake with an explicit valid `at` and invalid recurrence fires once and
stops.

## Repeating while something holds

`while` lists conditions in order, each a query over the whole graph and the
cadence it asks for while that query finds anything. At each firing the first
that holds sets the next instant; when none does, `every` does, and a wake
without one sleeps with `at` cleared. `rouse(graph, now)` arms each wake whose
condition now holds at that cadence from `now`, when that is sooner than the
instant it holds. A host calls it after its writes commit, so the write that
makes a condition hold is what wakes the wake.

```ts
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { rouse, wakeDoc, wakes } from '@yaks/wake'

const player = {
  component: true,
  type: 'object',
  properties: { seen: { type: 'string', format: 'date-time' } },
}
const vocab = loadVocab([wakeDoc, { $defs: { player } }])
const g = graph({ storage: ram(vocab), vocab, plugins: [wakes()] })
const now = Date.parse('2026-09-26T12:00:00Z')

await g.apply([{
  entity: { eid: 'world' },
  wake: {
    while: [
      { match: '.player.seen>=1-minute-ago', every: '30s' },
      { match: '.player.seen>=10-minutes-ago', every: '5m' },
    ],
  },
}])
await g.apply([{
  entity: { eid: 'bea' },
  player: { seen: new Date(now).toISOString() },
}])
const { roused } = await rouse(g, now)
assertEquals(roused[0].wake, { at: '2026-09-26T12:00:30.000Z' })
```

## Drivers per runtime

Cloudflare
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
can call `scheduled`, which uses the event's `scheduledTime` and fires every due
graph row. The trigger expression does not select an individual wake.

```ts
import { scheduled } from '@yaks/wake/cloudflare'

export default { scheduled: (event) => scheduled(graph, event) }
```

A Durable Object can set an earlier alarm:

```ts ignore
import { arm } from '@yaks/wake/cloudflare'
import { tick } from '@yaks/wake'

await arm(ctx.storage, wake, nextHeartbeat)
// In alarm(): await tick(graph, Date.now())
```

`arm(storage, wake, before)` preserves an alarm that is already earlier and
returns whether this wake needs an alarm. A wake without `at`, or one due at or
after `before`, leaves the alarm unchanged. A rejected wake waits for the next
Cron Trigger. The host owns its single alarm, including cancellation after
schedules change.

A Deno process can run the scheduler until shutdown:

```ts ignore
import { loop } from '@yaks/wake/deno'

const stop = new AbortController()
const running = loop(graph, {
  signal: stop.signal,
  cap: 60_000,
  onTick: ({ refused }) => report(refused),
})
stop.abort()
await running
```

The loop rouses and ticks immediately, then sleeps until the next pending
instant. Its default one-minute cap limits how long a new wake, or a sleeping
one a write made hold, waits to be noticed, and how soon a refused wake is
retried. Aborting releases the timer after any write in progress finishes.
`@yaks/wake/service` exposes the same loop as a host service and logs refused
wakes.

## Lower-level functions

- `due(storage, now)` returns overdue wake bundles, oldest first.
- `ring(bundle, now)` creates the firing change without applying it.
- `soonest(storage, now)` returns the earliest future instant.
- `pace(graph, wake, now)` returns the cadence of the first `while` condition
  that holds, or `null`.
- `starting(options)` returns the normalization hook used by `wakes()`.
- `wakeDoc`, also available from `@yaks/wake/vocab`, declares the components.

## Compatibility

The core uses web-standard APIs and runs in Deno, Node, Cloudflare workerd, and
browsers. Cron evaluation requires `Intl` and no `Temporal` polyfill. The
Cloudflare adapter accepts alarm storage structurally and imports no Cloudflare
global. The Deno loop uses `setTimeout` and `AbortSignal` and imports no
Deno-only API. The core is checked with browser-only types.
