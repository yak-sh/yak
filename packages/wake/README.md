# @yaks/wake

Coming back to something later, as data — the **scheduling** component domain
for a [@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/wake
# or: npx jsr add @yaks/wake
```

## The idea

A reminder on a calendar entry and a plant that wants watering every three days
are the same one thing: a row that says **when**. This package is that row, plus
the rule for reading it.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { wakeDoc, wakes } from '@yaks/wake'

let vocab = loadVocab([wakeDoc, mine])
let g = graph({ storage, vocab, plugins: [wakes()] })

g.apply([
  // a one-shot: nudge me the morning of
  {
    entity: { eid: 'w1' },
    wake: { at: '2026-03-14T09:00:00Z', target: dentist, note: 'leave early' },
  },
  // a cadence: every three days, starting now
  { entity: { eid: 'w2' }, wake: { every: '3d', target: fern } },
])
```

Two components:

| component                       | what it says                                           |
| ------------------------------- | ------------------------------------------------------ |
| `wake{at, every, target, note}` | come back at `at`, again every `every`, about `target` |
| `fired{at}`                     | when it last went off                                  |

`at` is the whole schedule for a one-shot. Add `every` and the same row recurs:
`at` becomes the **next** instant and moves forward each time. A wake with no
`at` left has finished — and can be wound back up by writing a new one.

## Two functions

```ts
import { due, ring } from '@yaks/wake'

let now = Date.now()
for (let w of due(storage, now)) { // the wakes whose hour has come
  water(w) // whatever the wake was for
  g.apply([ring(w, now)]) // stamp `fired`, and move `at` on
}
```

- **`due(storage, now?)`** → the bundles whose `wake.at` has passed, oldest
  first. One query — you can write it yourself if you want it narrower:
  `.wake.at<=<instant>`.
- **`ring(bundle, now?)`** → the patch that consumes one. A recurring wake's
  `at` moves to the next instant; a one-shot's is cleared; both stamp `fired`.
  It is a **bundle**, not a write, so you can apply it in the same batch as the
  work it named — one transaction, so a wake is never marked fired without the
  thing it was for.
- **`next(wake, now?)`** → when a recurring wake is next due, as an ISO instant,
  or `null` for a one-shot.
- **`soonest(storage, now?)`** → the earliest instant still ahead, for a host
  that can sleep until an exact moment.

Being away is not missing it. `at` is a row, not a process's memory, so a host
that was down for a day comes back, asks `due()`, and is handed everything owed
— **once**, not once per missed tick, because a cadence catches up in a single
step.

## How `every` is read

A **duration** counts from the last instant, so a reminder set at 09:17 keeps
landing at :17:

```
30s   2m   90m   2h   1d   3d   1w
every 15 minutes     every 3 days
```

A **cron line** names positions on a calendar, and lands at nine whatever time
you wrote it:

```
0 9 * * 1-5     */15 * * * *     @daily   @weekly   @monthly
```

Cron is parsed by [croner](https://jsr.io/@hexagon/croner) — dependency-free,
and the same parser in a browser, a Worker and a server. It is read in **UTC**
unless you name a zone (`wakes({ tz: 'America/New_York' })`), because a schedule
in a graph is read back by whoever happens to be running, and one schedule has
to mean one instant.

An `every` this package cannot read is `null`, never a throw: the wake fires
once, on its `at`, and stops. Loud beats silent; stopped beats a storm.

## It fires nothing

There is no timer in this package, on purpose. **When to come back is a property
of the host, not of the data.** All of these call the same `due()` and get the
same answer:

### A server tick

```ts
import { due, ring, soonest } from '@yaks/wake'

let sweep = async () => {
  let now = Date.now()
  for (let w of await due(storage, now)) await g.apply([ring(w, now)])
  let at = await soonest(storage, Date.now())
  // setTimeout's ceiling is ~24 days, and a suspended machine drifts; an
  // hourly floor makes both harmless.
  setTimeout(
    sweep,
    Math.min(Math.max((at ?? Infinity) - Date.now(), 0), 3600e3),
  )
}
```

### A Durable Object `alarm()`

A Durable Object can hold exactly one alarm, which is exactly what `soonest()`
answers. Set it whenever a wake appears or moves, and re-set it at the end of
every `alarm()`:

```ts
import { due, ring, soonest } from '@yaks/wake'

export class Graph {
  // …storage and graph built with @yaks/durable-object…

  // Point the single alarm at the earliest wake still ahead. Idempotent:
  // call it after any batch, from `created('wake')`, and at the end of alarm().
  async arm() {
    let at = await soonest(this.storage, Date.now())
    if (at == null) return this.ctx.storage.deleteAlarm()
    let set = await this.ctx.storage.getAlarm()
    if (set !== at) await this.ctx.storage.setAlarm(at)
  }

  async alarm() {
    let now = Date.now()
    for (let w of await due(this.storage, now)) {
      await this.run(w) // whatever the wake names
      await this.graph.apply([ring(w, now)])
    }
    await this.arm() // the next one, or none
  }
}
```

Two things make this safe. `alarm()` retries on a throw, and `due()` is a query
— so a retry after a partial run finds only what is still owed, since every wake
already rung has moved its `at`. And an alarm that never fired (the object was
evicted, the deploy rolled) is not a lost wake: the next `alarm()`, request or
`arm()` reads the same rows and catches up.

### A client

A browser tab is not a scheduler — it is asleep half the time — so it asks on
the way in rather than on a timer:

```ts
// on load, and on focus
let now = Date.now()
for (let w of due(store, now)) show(w)
```

Because the rule is one query over rows, all three agree, and a wake set in the
tab is honoured by the server that reads the same graph.

## Where a host hangs its own behaviour

`@yaks/effects` is the seam. This package registers no handler; it leaves the
slot:

```ts
fx.created('wake', (e, tx) => arm()) // a new wake — re-point the clock
fx.changed('wake', 'at', (e, tx) => arm()) // one moved — same
```

Running what a wake NAMES is yours too. This package deliberately has no opinion
about it: a wake is a time and a `target`, and what to do about the target when
the hour comes belongs to the application that knows what the target is.

## What is deliberately not here

**A timer**, as above. **A delivery mechanism** — a wake that also knew how to
send an email would be a second thing to keep true; a `created('fired')` handler
is where that goes. **A calendar** — recurrence exceptions, "the third Tuesday
unless it is a holiday", and time-zone-shifting events are a calendar's job, not
a schedule's. And **a log of every firing**: `fired.at` is overwritten, because
the useful question is "has this already gone off", and a host that wants the
history writes its own rows.

## Where it sits

A domain plugin over [@yaks/graph](https://jsr.io/@yaks/graph). It imports no
platform API, so the same rules run on a server, in a Worker, and in a browser
tab.
