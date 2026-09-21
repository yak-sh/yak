# @yaks/wake

Scheduled work stored as graph components, with recurrence calculation and
adapters for several runtimes. Throughout this README, "the host" means the
program that runs this package — a Deno server, a Cloudflare Worker, a Durable
Object, a browser tab. The host decides what each due wake does and when to run
the scheduling loop.

```sh
deno add jsr:@yaks/wake
```

## The rows

`wake{at, every, target, note}` records when to come back to something,
optionally how often, what it is about, and why. `fired{at}` records the most
recent firing. A one-shot clears `wake.at`; a recurring wake moves it past the
current instant.

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

A wake carries no patch to apply when it fires. A rule's `produce` already
writes the entity it matched. Patching a wake's target declaratively would need
a rule that names that target. `target` is only a reference describing what the
wake is about.

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

`tick(graph, now)` finds due wakes and applies **one transaction per wake**: the
`fired{at}` value and the next `wake.at`, or `null`. `#Now` holds that same
instant. The graph's own phases run the rules. `produce` is the declarative
case; `run` is code. An effect's `*fired` requires that `fired` was written in
this same transaction, so editing a note later does not repeat the job.

A rejected transaction leaves its wake due and does not stop the others. The
result is `{ fired: Bundle[], refused: { wake: Bundle, error: unknown }[] }`. A
precondition on the previously read `wake.at` and `wake.every` prevents two
concurrent drivers from consuming one occurrence twice or advancing a recurrence
that was edited in between. Effect failures are reported to the graph's error
reporter after the commit; they do not undo the firing or turn it into a
rejected transaction.

After downtime, each overdue wake fires once and advances beyond `now`.
Occurrences missed while the host was not running are collapsed into that one
firing. A process crash after the commit can interrupt an effect; this driver
does not retry effects durably. Use a durable effect ledger when the job needs
that guarantee.

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

The **trailing field** is an optional IANA time zone; there is no separate `tz`
column:

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

## Drivers per runtime

Cloudflare
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
are what calls the scheduler. The event's `scheduledTime` supplies the instant;
its cron string does not select which job runs — the due `wake` rows do.

```ts
import { scheduled } from '@yaks/wake/cloudflare'

// export default { scheduled: (event) => scheduled(graph, event) }
```

A Durable Object can set its alarm for a wake that falls before the next Cron
Trigger:

```ts
import { arm } from '@yaks/wake/cloudflare'
import { tick } from '@yaks/wake'

// await arm(ctx.storage, wake, nextHeartbeat)
// In alarm(): await tick(graph, Date.now())
// Then arm the next pending wake. Wakes whose transaction was rejected wait
// for the next Cron Trigger.
```

`arm(storage, wake, before)` keeps an alarm that is already earlier, and returns
whether this wake needs an alarm at all. A wake with no `at`, or a later one,
leaves the alarm alone. The host owns its single alarm, including cancelling it
when its schedules change.

A Deno process can run the loop until shutdown:

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

The loop ticks immediately and then sleeps until the next pending instant,
capped at one minute by default. The cap also bounds how long a newly written
wake waits to be noticed, and how often a wake whose transaction was rejected is
retried. Aborting releases the timer once any write already in progress
finishes.

## Lower-level functions

- `due(storage, now)` reads overdue wakes, oldest first.
- `ring(bundle, now)` builds the firing patch without applying it.
- `soonest(storage, now)` reads the earliest future instant.
- `wakes({ now?, tz? })` contributes the vocabulary and gives a wake written
  with a recurrence and no `at` its first instant. An explicit `at: null` leaves
  it paused.

## Compatibility

The core and the per-runtime helpers use web-standard APIs available in Deno,
Node and Cloudflare workerd. Cron uses `Intl`; no `Temporal` polyfill is needed.
The Cloudflare helper accepts the storage alarm methods structurally and imports
no Cloudflare global. The Deno loop uses `setTimeout` and `AbortSignal` and
imports no Deno-only API. The core is also checked with browser-only types.
