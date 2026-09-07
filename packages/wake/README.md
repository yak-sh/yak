# @yaks/wake

Schedules as graph rows for Deno, Cloudflare Workers and browsers. The component
stays `wake`; cron is one spelling of its recurrence.

```sh
deno add jsr:@yaks/wake
```

## The rows

`wake{at, every, target, note}` says when to return, optionally how often, what
it is about, and why. `fired{at}` records the latest firing. A one-shot clears
`wake.at`; a recurring wake moves it past the current instant.

```ts
import { next } from '@yaks/wake'

let every = '20 4 * * * America/Detroit'
let row = {
  entity: { eid: 'cleanup' },
  wake: { every, at: next(every, Date.now()), note: 'collect expired trash' },
  sweep: {},
}
// await graph.apply([row])
```

There is no `apply` patch on a wake. A rule's `produce` already writes the
entity it matched. A future declarative target patch needs a rule that names a
target. `target` remains a reference describing what the wake is about.

## Firing is a write

```ts
import { tick } from '@yaks/wake'
import type { Rule } from '@yaks/graph'

let cleanup: Rule = {
  phase: 'effect',
  match: '.wake, *fired, .sweep, #Now',
  run: async ({ Now }) => {
    // await collectExpiredTrash(Now.at)
  },
}
// await tick(graph, Date.now())
```

`tick(graph, now)` finds due wakes and applies **one batch per wake**: the
`fired{at}` stamp and the next `wake.at`, or `null`. `#Now` has that same
instant. The graph's own phases run the rules. `produce` is the declarative
case; `run` is code. An effect's `*fired` requires a write to `fired` in this
batch, so editing a note later does not repeat the job.

A refused batch leaves its wake due and does not stop the others. The result is
`{ fired: Bundle[], refused: { wake: Bundle, error: unknown }[] }`. A guard on
the previously read `wake.at` prevents overlapping drivers from consuming one
occurrence twice. Effect failures go to the graph's reporter after commit; they
do not undo the firing or make it a refused batch.

After downtime, each overdue wake fires once and advances beyond `now`.
Occurrences missed while the host was absent are coalesced. A process crash
after commit can interrupt an effect; this driver supplies no durable effect
retries. Use a durable effect ledger when the job needs that guarantee.

## Recurrence

Durations keep their original cadence, including after downtime:

```text
30s   2m   90m   2h   1d   3d   1w
every 15 minutes     every 3 days
```

Cron uses five fields: minute, hour, day of month, month, day of week. Fields
accept wildcards, ranges, steps and lists. Sunday is 0 or 7; when both day
fields restrict the schedule, either can match. Named schedules are `@hourly`,
`@daily`, `@weekly` and `@monthly`.

The **trailing word** is an optional IANA zone; there is no `tz` column:

```text
*/15 * * * *
5-50/15 9-17 * * 1-5
20 4 * * * America/Detroit
@daily Asia/Kathmandu
```

UTC is the default. A trailing zone overrides the caller's default zone.
`next(expr, from, tz?)` returns the next ISO instant strictly after the epoch
millisecond `from`, or `null`. The existing `next(wake, now, { tz })` form keeps
a duration anchored to the wake's own `at`.

[Croner](https://jsr.io/@hexagon/croner) reads calendars through `Intl`, without
a build step. Its existing DST behavior is retained: a missing spring time moves
forward by the gap, and a repeated fall time fires once, at the first
occurrence. An invalid expression or zone returns `null`; a wake with an
explicit `at` and invalid recurrence fires once and stops.

## Host drivers

Cloudflare
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
are the heartbeat. The event's `scheduledTime` supplies the instant; its cron
string does not select a job.

```ts
import { scheduled } from '@yaks/wake/cloudflare'

// export default { scheduled: (event) => scheduled(graph, event) }
```

A Durable Object can set its alarm for a wake before the next heartbeat:

```ts
import { arm } from '@yaks/wake/cloudflare'
import { tick } from '@yaks/wake'

// await arm(ctx.storage, wake, nextHeartbeat)
// In alarm(): await tick(graph, Date.now())
// Then arm the next pending wake. Refused wakes remain for the heartbeat.
```

`arm(storage, wake, before)` preserves an already earlier alarm and returns
whether this wake needs an alarm. Absent or later dates leave it alone. The host
owns its one alarm, including cancelling it when its schedules change.

A Deno box or tasks server can run the loop until shutdown:

```ts
import { loop } from '@yaks/wake/deno'

let stop = new AbortController()
// let running = loop(graph, {
//   signal: stop.signal,
//   cap: 60_000,
//   onTick: ({ refused }) => { /* report refusals */ },
// })
// stop.abort()
// await running
```

The loop ticks immediately and sleeps until the next pending instant, capped at
one minute by default. The cap also bounds how long a newly written wake waits
to be noticed and how often refused wakes retry. Aborting releases the timer
after any in-flight write finishes.

## Lower-level functions

- `due(storage, now)` reads overdue wakes, oldest first.
- `ring(bundle, now)` builds the firing patch without applying it.
- `soonest(storage, now)` reads the earliest future instant.
- `wakes({ now?, tz? })` contributes the vocabulary and initializes a bare
  recurrence with its first instant.

## Compatibility

The core and host helpers use web-standard APIs available in Deno, Node and
Cloudflare workerd. Cron uses `Intl`; no `Temporal` polyfill is needed. The
Cloudflare helper accepts the storage alarm methods structurally and imports no
Cloudflare global. The Deno loop uses `setTimeout` and `AbortSignal` and imports
no Deno-only API. The core is also checked with browser-only types.
